import type { RowDatabase } from '../server/database.ts'
import { tooManyRequests } from '../server/errors.ts'
import { insert } from '../server/sql.ts'

export type Limits =
  { startsPerWindow: number
  , windowMs: number
  , maxFailures: number
  , lockMs: number
  }

export const DEFAULT_LIMITS: Limits =
  { startsPerWindow: 30
  , windowMs: 60_000
  , maxFailures: 5
  , lockMs: 15 * 60_000
  }

const ATTEMPT_TTL_MS = 10 * 60_000

/** Login throttling stored in auth_limit, so it survives restarts and is shared by every process. */
export const createLimits =
  (db: RowDatabase, limits: Limits = DEFAULT_LIMITS) => {
    const live =
      'UPDATE `auth_limit` SET `count` = `count` + 1'
      + ' WHERE `key` = ? AND `expires_at` > ? RETURNING `count`'

    /** Count one more event for a key within its window and return the count. */
    const bump =
      async (key: string, ttlMs: number) => {
        const now = Date.now()
        const row = await db.get(live, [key, now])
        if (row) return Number(row.count)

        await db.run('DELETE FROM `auth_limit` WHERE `key` = ?', [key])
        try {
          await insert(db, 'auth_limit', { key, count: 1, expires_at: now + ttlMs })
          return 1
        } catch {
          // Another request created the counter first.
          return Number((await db.get(live, [key, now]))?.count ?? 1)
        }
      }

    /** Store a value for a key until it expires, replacing any earlier one. */
    const put =
      async (key: string, value: string | null, ttlMs: number) => {
        await db.run('DELETE FROM `auth_limit` WHERE `key` = ?', [key])
        await insert(
          db, 'auth_limit', { key, value, expires_at: Date.now() + ttlMs })
          .catch(() => undefined)
      }

    /** Read and remove the value stored for a key. */
    const take =
      async (key: string) => {
        const row =
          await db.get('SELECT `value` FROM `auth_limit` WHERE `key` = ?', [key])
        await db.run('DELETE FROM `auth_limit` WHERE `key` = ?', [key])
        return typeof row?.value === 'string' ? row.value : undefined
      }

    return (
      /** Reject a registration start when one client is starting too many. */
      { register: async (client: string) => {
          if (await bump(`register:${client}`, limits.windowMs) > limits.startsPerWindow)
            throw tooManyRequests('Too many registration attempts; try again later')
        }
      /** Reject a login start when the user is locked or the user or client is too busy. */
      , start: async (username: string, client: string) => {
          const now = Date.now()
          await db.run('DELETE FROM `auth_limit` WHERE `expires_at` <= ?', [now])
          if (await db.get(
            'SELECT 1 AS locked FROM `auth_limit` WHERE `key` = ?'
            , [`lock:${username}`]))
            throw tooManyRequests('Too many failed logins; try again later')

          for (const key of [`user:${username}`, `client:${client}`])
            if (await bump(key, limits.windowMs) > limits.startsPerWindow)
              throw tooManyRequests('Too many login attempts; try again later')
        }
      /** Remember which username a login state belongs to. */
      , track: (stateId: string, username: string) =>
          put(`attempt:${stateId}`, username, ATTEMPT_TTL_MS)
      /** Count a failed login finish and lock the username at the limit. */
      , fail: async (stateId: string) => {
          const username = await take(`attempt:${stateId}`)
          if (username === undefined) return
          if (await bump(`fail:${username}`, limits.lockMs) >= limits.maxFailures) {
            await put(`lock:${username}`, null, limits.lockMs)
            await db.run(
              'DELETE FROM `auth_limit` WHERE `key` = ?', [`fail:${username}`])
          }
        }
      /** Clear the failure count after a successful login. */
      , succeed: async (stateId: string) => {
          const username = await take(`attempt:${stateId}`)
          if (username !== undefined)
            await db.run(
              'DELETE FROM `auth_limit` WHERE `key` = ?', [`fail:${username}`])
        }
      })
  }

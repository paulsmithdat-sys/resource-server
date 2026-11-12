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

export const createLimits =
  (db: RowDatabase, limits: Limits = DEFAULT_LIMITS) => {
    // Purpose: login throttling stored in auth_limit, so it survives restarts and is shared by every process
    const live =
      'UPDATE `auth_limit` SET `count` = `count` + 1'
      + ' WHERE `key` = ? AND `expires_at` > ? RETURNING `count`'

    const bump =
      async (key: string, ttlMs: number) => {
        // Purpose: count one more event for a key within its window and return the count
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

    const put =
      async (key: string, value: string | null, ttlMs: number) => {
        // Purpose: store a value for a key until it expires, replacing any earlier one
        await db.run('DELETE FROM `auth_limit` WHERE `key` = ?', [key])
        await insert(
          db, 'auth_limit', { key, value, expires_at: Date.now() + ttlMs })
          .catch(() => undefined)
      }

    const take =
      async (key: string) => {
        // Purpose: read and remove the value stored for a key
        const row =
          await db.get('SELECT `value` FROM `auth_limit` WHERE `key` = ?', [key])
        await db.run('DELETE FROM `auth_limit` WHERE `key` = ?', [key])
        return typeof row?.value === 'string' ? row.value : undefined
      }

    return (
      { register: async (client: string) => {
          // Purpose: reject a registration start when one client is starting too many
          if (await bump(`register:${client}`, limits.windowMs) > limits.startsPerWindow)
            throw tooManyRequests('Too many registration attempts; try again later')
        }
      , start: async (username: string, client: string) => {
          // Purpose: reject a login start when the user is locked or the user or client is too busy
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
      , track: (stateId: string, username: string) =>
          // Purpose: remember which username a login state belongs to
          put(`attempt:${stateId}`, username, ATTEMPT_TTL_MS)
      , fail: async (stateId: string) => {
          // Purpose: count a failed login finish and lock the username at the limit
          const username = await take(`attempt:${stateId}`)
          if (username === undefined) return
          if (await bump(`fail:${username}`, limits.lockMs) >= limits.maxFailures) {
            await put(`lock:${username}`, null, limits.lockMs)
            await db.run(
              'DELETE FROM `auth_limit` WHERE `key` = ?', [`fail:${username}`])
          }
        }
      , succeed: async (stateId: string) => {
          // Purpose: clear the failure count after a successful login
          const username = await take(`attempt:${stateId}`)
          if (username !== undefined)
            await db.run(
              'DELETE FROM `auth_limit` WHERE `key` = ?', [`fail:${username}`])
        }
      })
  }

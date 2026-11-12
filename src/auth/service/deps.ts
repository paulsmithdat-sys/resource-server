import type { Row, RowDatabase } from '../../server/database.ts'
import { createLimits, DEFAULT_LIMITS, type Limits } from '../limits.ts'
import { unauthorized } from '../../server/errors.ts'
import { insert } from '../../server/sql.ts'
import { uuidToBuffer } from '../../server/uuid.ts'
import { json, type KeyType } from './helpers.ts'

/** Shared pieces the registration, login and key handlers build on. */
export type AuthDeps =
  { db: RowDatabase
  , serverSetup: string
  , throttle: ReturnType<typeof createLimits>
  , record: (action: string, user: unknown) => Promise<void>
  , purgeExpired: () => Promise<unknown>
  , insertKey: (tx: RowDatabase, row: KeyRow) => Promise<unknown>
  , consume: (tx: RowDatabase, type: KeyType, id: Uint8Array, now: number, columns: string) => Promise<Row>
  }

/** A row to insert into the hidden `key` table. */
export type KeyRow =
  { type: KeyType
  , id: string
  , jwk?: unknown
  , clientJwk?: unknown
  , material?: string
  , expiresAt?: number
  , userId?: string | null
  , keyBuffer?: Uint8Array
  }

/**
 * Build the shared helpers for one database.
 *
 * @param options - The database, OPAQUE server setup, rate limits and audit flag.
 */
export const createDeps =
  ( { db, serverSetup, limits = DEFAULT_LIMITS, audit = false }:
      { db: RowDatabase, serverSetup: string, limits?: Limits, audit?: boolean }
  ): AuthDeps => {
    // Purpose: build the audit, throttle, purge, insert and consume helpers the handlers share
    const record =
      async (action: string, user: unknown) => {
        // Purpose: write a login event to audit_log when auditing is available
        if (audit)
          await insert(
            db, 'audit_log', { actor: user ?? null, action, resource: 'session' })
      }

    const throttle = createLimits(db, limits)
    const purgeExpired =
      () =>
        db.run(
          'DELETE FROM `key` WHERE `expires_at` IS NOT NULL AND `expires_at` <= ?'
          , [Date.now()])

    const insertKey =
      (tx: RowDatabase
      , row:
          { type: KeyType
          , id: string
          , jwk?: unknown
          , clientJwk?: unknown
          , material?: string
          , expiresAt?: number
          , userId?: string | null
          , keyBuffer?: Uint8Array
          }) => {
        const user = row.userId ? uuidToBuffer(row.userId) : null
        return tx.run(
          'INSERT INTO `key` (`id`, `type`, `jwk`, `client_jwk`, `material`,'
          + ' `expires_at`, `user_id`, `owner`) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
          , [ row.keyBuffer ?? uuidToBuffer(row.id)
            , row.type
            , json(row.jwk)
            , json(row.clientJwk)
            , row.material ?? null
            , row.expiresAt ?? null
            , user
            , user
            ])
      }

    // Atomically marks an unexpired, unused state row consumed and returns it.
    const consume =
      async (
        tx: RowDatabase,
        type: KeyType,
        id: Uint8Array,
        now: number,
        columns: string) => {
        const row =
          await tx.get(
            'UPDATE `key` SET `consumed_at` = ? WHERE `id` = ? AND `type` = ?'
            + ' AND `consumed_at` IS NULL AND `expires_at` IS NOT NULL'
            + ` AND \`expires_at\` > ? RETURNING ${columns}`
            , [now, id, type, now])
        if (!row)
          throw unauthorized(
            `${type === 'session' ? 'Session' : type === 'opaque_login_state' ? 'Login' : 'Registration'}`
            + ' state is invalid, expired, or already used')
        return row
      }
    return { db, serverSetup, throttle, record, purgeExpired, insertKey, consume }
  }

import type { RowDatabase } from './database.ts'
import { unauthorized } from './errors.ts'
import { sessionKeyId } from '../auth/session-key.ts'
import { canonicalUuid, uuidToBuffer } from './uuid.ts'

/**
 * Reads `Authorization: Bearer <sessionId>`, validates it against the hidden
 * `key` table, and sets `userId` on the Hono context. Any missing, malformed,
 * expired or consumed session is a 401.
 */
export const sessionMiddleware =
  (db: RowDatabase) =>
  async (c: any, next: any) => {
    const header = c.req.header('authorization') ?? ''
    if (!header.startsWith('Bearer '))
      throw unauthorized('Session is required')

    const token = header.slice('Bearer '.length)
    try {
      uuidToBuffer(token)
    } catch {
      throw unauthorized('Invalid session id')
    }
    const sessionKey = sessionKeyId(token)

    const row =
      await db.get(
        "SELECT `user_id`, `client_jwk` FROM `key` WHERE `id` = ? AND `type` = 'session'"
        + ' AND `consumed_at` IS NULL'
        + ' AND (`expires_at` IS NULL OR `expires_at` > ?)'
        , [sessionKey, Date.now()])

    if (!row) throw unauthorized('Invalid or expired session')
    if (!row.user_id)
      throw unauthorized('Session is not associated with a user')

    c.set('userId', canonicalUuid(row.user_id))
    c.set('sessionId', canonicalUuid(token))
    c.set('sessionKey', sessionKey)
    c.set(
      'clientJwk'
      , typeof row.client_jwk === 'string' ? JSON.parse(row.client_jwk) : undefined)

    await next()
  }

import type { Hono } from 'hono'
import type { RowDatabase } from './database.ts'
import { unauthorized } from './errors.ts'
import { quoteIdentifier } from './query.ts'
import { canonicalUuid, uuidToBuffer } from './uuid.ts'

/**
 * Extracts an OPAQUE session from the `Authorization: Bearer <sessionId>`
 * header, validates it against the hidden `key` table, and attaches the
 * owning `userId` to the Hono context as `c.get('userId')`.
 *
 * Throws 401 when no session is provided or the session is invalid,
 * expired, or already consumed.
 */
export const sessionMiddleware =
  (db: RowDatabase) =>
  async (c: any, next: any) => {
    const authHeader = c.req.header('authorization')
    const sessionId =
      authHeader?.startsWith('Bearer ')
        ? authHeader.slice('Bearer '.length)
        : undefined

    if (!sessionId)
      throw unauthorized('Session is required')

    let sessionIdBuffer: unknown
    try {
      sessionIdBuffer = uuidToBuffer(sessionId)
    } catch {
      throw unauthorized('Invalid session id')
    }

    const now = Date.now()
    const row = await db.get(
      `SELECT ${quoteIdentifier('user_id')} AS userId`
      + ` FROM ${quoteIdentifier('key')}`
      + ` WHERE ${quoteIdentifier('id')} = ?`
      + ` AND ${quoteIdentifier('type')} = 'session'`
      + ` AND ${quoteIdentifier('consumed_at')} IS NULL`
      + ` AND (${quoteIdentifier('expires_at')} IS NULL`
      + ` OR ${quoteIdentifier('expires_at')} > ?)`
      , [sessionIdBuffer, now])

    if (!row)
      throw unauthorized('Invalid or expired session')

    const userId =
      row.userId === null || row.userId === undefined
        ? null
        : canonicalUuid(row.userId)

    if (!userId)
      throw unauthorized('Session is not associated with a user')

    c.set('userId', userId)
    c.set('sessionId', sessionId)

    await next()
  }

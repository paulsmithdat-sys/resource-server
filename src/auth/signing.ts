import type { AppContext, Next } from '../server/context.ts'
import nacl from 'tweetnacl'
import type { RowDatabase } from '../server/database.ts'
import { unauthorized } from '../server/errors.ts'
import { insert } from '../server/sql.ts'
import { signingMessage } from '../client/crypto.ts'
import { parsePublicJwk } from './keys.ts'

// One implementation of the signed bytes, shared with the client so they cannot drift
export { signingMessage }

export const SIGNATURE_WINDOW_MS = 60_000
export const SIGNATURE_HEADER = 'x-serber-signature'
export const TIMESTAMP_HEADER = 'x-serber-timestamp'
export const NONCE_HEADER = 'x-serber-nonce'

const NONCE_PATTERN = /^[A-Za-z0-9_-]{16,128}$/

export const verifySignedRequest =
  async (c: AppContext, db: RowDatabase, required: boolean) => {
    // Purpose: check a request's Ed25519 signature and burn its nonce; returns whether the request was signed
    const signature = c.req.header(SIGNATURE_HEADER)
    const timestamp = c.req.header(TIMESTAMP_HEADER)
    const nonce = c.req.header(NONCE_HEADER)
    if (!required && !signature && !timestamp && !nonce) return false
    if (!signature || !timestamp || !nonce)
      throw unauthorized('This request must be signed')

    const now = Date.now()
    const time = Number(timestamp)
    if (!/^\d+$/.test(timestamp) || Math.abs(now - time) > SIGNATURE_WINDOW_MS)
      throw unauthorized('Signature timestamp is missing or outside the allowed window')
    if (!NONCE_PATTERN.test(nonce))
      throw unauthorized('Signature nonce must be 16-128 URL-safe characters')

    const jwk = c.get('clientJwk')
    if (!jwk) throw unauthorized('This session has no client key to verify signatures')
    const publicKey = Buffer.from(parsePublicJwk(jwk).x, 'base64url')

    const url = new URL(c.req.url)
    const body = new Uint8Array(await c.req.raw.clone().arrayBuffer())
    const message =
      await signingMessage(
        { method: c.req.method
        , path: url.pathname + url.search
        , sessionId: c.get('sessionId') as string
        , timestamp
        , nonce
        , body
        })
    const bytes = Buffer.from(signature, 'base64url')
    if (bytes.length !== nacl.sign.signatureLength
        || !nacl.sign.detached.verify(message, bytes, publicKey))
      throw unauthorized('Request signature is invalid')

    // Only a valid signature burns a nonce, so forged requests cannot use up nonces.
    await db.run('DELETE FROM `request_nonce` WHERE `expires_at` <= ?', [now])
    try {
      await insert(
        db, 'request_nonce'
        , { session_id: c.get('sessionKey')
          , nonce
          , expires_at: now + 2 * SIGNATURE_WINDOW_MS
          })
    } catch {
      throw unauthorized('Request nonce has already been used')
    }
    return true
  }

import * as opaque from '@serenity-kit/opaque'
import { sessionKeyId } from '../session-key.ts'
import { unauthorized } from '../../server/errors.ts'
import { canonicalUuid, newUuid } from '../../server/uuid.ts'
import { generateKeyPair, parsePrivateJwk, parsePublicJwk, publicJwkFromPrivate } from '../keys.ts'
import { validate, loginStart, loginFinish } from '../validation.ts'
import type { AuthDeps } from './deps.ts'
import { LOGIN_TTL_MS, SESSION_TTL_MS, keyId, iso, parseStored, clientKey, opaqueStep } from './helpers.ts'

/**
 * Build the OPAQUE login start and finish handlers.
 */
export const loginHandlers =
  ({ db, serverSetup, throttle, record, purgeExpired, insertKey, consume }: AuthDeps) => {
    const startLogin =
      async (raw: unknown, client = 'unknown') => {
        await opaque.ready
        const body = validate(loginStart, raw)
        // Only needed for x-access "signed" resources, so it is optional.
        const publicJwk =
          body.clientPublicKey === undefined ? undefined : clientKey(body)
        const username = (body.username as string).toLowerCase()
        await throttle.start(username, client)

        await purgeExpired()

        // Unknown users and users without a finished registration get the same
        // response shape, so the start step does not reveal who exists.
        const user =
          await db.get(
            'SELECT `id` FROM `user` WHERE lower(`username`) = ? LIMIT 1'
            , [username])
        const record =
          user
            ? await db.get(
                'SELECT `material` FROM `key` WHERE `user_id` = ?'
                + " AND `type` = 'opaque_registration'"
                + ' AND `consumed_at` IS NOT NULL AND `expires_at` IS NULL'
                + ' AND `material` IS NOT NULL'
                + ' ORDER BY `consumed_at` DESC LIMIT 1'
                , [user.id])
            : undefined
        const userId =
          typeof record?.material === 'string'
            ? canonicalUuid(user!.id)
            : null

        const { loginResponse, serverLoginState } =
          opaqueStep(
            'startLoginRequest'
            , () =>
                opaque.server.startLogin(
                  { serverSetup
                  , registrationRecord: userId ? record!.material as string : null
                  , startLoginRequest: body.startLoginRequest as string
                  , userIdentifier: userId ?? newUuid()
                  }))

        const id = newUuid()
        const expiresAt = Date.now() + LOGIN_TTL_MS
        const serverKeyPair = generateKeyPair()

        await insertKey(
          db
          , { id
            , type: 'opaque_login_state'
            , jwk: serverKeyPair.privateJwk
            , clientJwk: publicJwk
            , material: serverLoginState
            , expiresAt
            , userId
            })
        await throttle.track(id, username)

        return (
          { id
          , type: 'opaque_login_state'
          , expiresAt: iso(expiresAt)
          , loginResponse
          , serverPublicKey: serverKeyPair.publicJwk
          })
      }

    const finishLogin =
      async (id: string, raw: unknown) => {
        await opaque.ready
        const { finishLoginRequest } = validate(loginFinish, raw)
        const idValue = keyId(id)
        const now = Date.now()

        // The state is consumed first and never restored, so a failed finish
        // cannot be retried against the same login state.
        const login =
          await consume(
            db
            , 'opaque_login_state'
            , idValue
            , now
            , '`user_id`, `material`, `jwk`, `client_jwk`')

        const sessionKey =
          login.user_id
            ? (() => {
                try {
                  return opaque.server.finishLogin(
                    { serverLoginState: String(login.material)
                    , finishLoginRequest: finishLoginRequest as string
                    }).sessionKey
                } catch {
                  return undefined
                }
              })()
            : undefined
        if (!sessionKey) {
          await throttle.fail(id.toLowerCase())
          await record('login_failed', login.user_id)
          throw unauthorized('Invalid username or password')
        }
        await throttle.succeed(id.toLowerCase())
        await record('login', login.user_id)

        const privateJwk =
          parsePrivateJwk(parseStored(login.jwk, 'login server key'))
        // A v4 UUID (122 random bits) is the bearer token; only its hash is stored.
        const sessionId = crypto.randomUUID()
        const expiresAt = now + SESSION_TTL_MS

        await insertKey(
          db
          , { id: sessionId
            , keyBuffer: sessionKeyId(sessionId)
            , type: 'session'
            , jwk: privateJwk
            , clientJwk:
                login.client_jwk
                  ? parsePublicJwk(parseStored(login.client_jwk, 'login client key'))
                  : undefined
            , material: sessionKey
            , expiresAt
            , userId: canonicalUuid(login.user_id)
            })

        return (
          { sessionId
          , userId: canonicalUuid(login.user_id)
          , type: 'session'
          , expiresAt: iso(expiresAt)
          , serverPublicKey: publicJwkFromPrivate(privateJwk)
          })
      }

    return { startLogin, finishLogin }
  }

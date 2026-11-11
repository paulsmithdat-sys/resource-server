import * as opaque from '@serenity-kit/opaque'
import type { RowDatabase } from '../server/database.ts'
import { sessionKeyId } from './session-key.ts'
import { createLimits, DEFAULT_LIMITS, type Limits } from './limits.ts'
import { badRequest, conflict, notFound, unauthorized } from '../server/errors.ts'
import { isObject } from '../server/guard.ts'
import { insert } from '../server/sql.ts'
import { canonicalUuid, newUuid, uuidToBuffer } from '../server/uuid.ts'
import
  { generateKeyPair
  , parsePrivateJwk
  , parsePublicJwk
  , publicJwkFromPrivate
  , type PublicJwk
  } from './keys.ts'
import
  { validate
  , registrationStart
  , loginStart
  , registrationFinish
  , loginFinish
  } from './validation.ts'

const MINUTE = 60_000
export const REGISTRATION_TTL_MS = 10 * MINUTE
export const LOGIN_TTL_MS = 10 * MINUTE
export const SESSION_TTL_MS = 24 * 60 * MINUTE

type KeyType = 'opaque_registration' | 'opaque_login_state' | 'session'

export type AuthService =
  { startRegistration: (body: unknown) => Promise<{ id: string }>
  , startLogin: (body: unknown, client?: string) => Promise<{ id: string }>
  , finishKey: (id: string, body: unknown) => Promise<unknown>
  , getKey: (id: string) => Promise<unknown>
  , deleteKey: (id: string) => Promise<void>
  }

const keyId =
  (value: string) => {
    try {
      return uuidToBuffer(value)
    } catch {
      throw badRequest('"id" must be a canonical UUID', 'id')
    }
  }

const iso =
  (value: unknown) => {
    if (value === null || value === undefined) return null
    const millis = Number(value)
    return Number.isFinite(millis) ? new Date(millis).toISOString() : null
  }

const json =
  (value: unknown) =>
    value === undefined ? null : JSON.stringify(value)

const parseStored =
  (value: unknown, label: string): unknown => {
    try {
      return JSON.parse(value as string)
    } catch {
      throw new Error(`Stored ${label} is missing or invalid`)
    }
  }

const clientKey =
  (body: Record<string, unknown>): PublicJwk => {
    try {
      return parsePublicJwk(body.clientPublicKey)
    } catch (error) {
      throw badRequest(
        error instanceof Error
          ? error.message
          : 'clientPublicKey must be an Ed25519 public JWK'
        , 'clientPublicKey')
    }
  }

const opaqueStep =
  <T>(field: string, step: () => T): T => {
    try {
      return step()
    } catch {
      throw badRequest(`"${field}" is invalid`, field)
    }
  }

const mapWriteError =
  (error: unknown) => {
    const message = error instanceof Error ? error.message : String(error)
    if (/UNIQUE constraint failed/i.test(message))
      return conflict('A user with that username or email already exists')
    if (/FOREIGN KEY constraint failed/i.test(message))
      return conflict('The referenced user does not exist')
    return error instanceof Error ? error : new Error(message)
  }

const inTransaction =
  <T>(db: RowDatabase, fn: (db: RowDatabase) => Promise<T>): Promise<T> =>
    db.transaction ? db.transaction(fn) : fn(db)

export const createAuthService =
  ( { db, serverSetup, limits = DEFAULT_LIMITS, audit = false }:
      { db: RowDatabase, serverSetup: string, limits?: Limits, audit?: boolean }
  ): AuthService => {
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

    const startRegistration =
      async (raw: unknown) => {
        await opaque.ready
        const body = validate(registrationStart, raw)
        const username = (body.username as string).toLowerCase()
        const email = (body.email as string).toLowerCase()
        const publicJwk = clientKey(body)

        await purgeExpired()

        if (await db.get(
          'SELECT 1 FROM `user` WHERE lower(`username`) = ? OR lower(`email`) = ? LIMIT 1'
          , [username, email]))
          throw conflict('A user with that username or email already exists')

        const userId = newUuid()
        const id = newUuid()
        const expiresAt = Date.now() + REGISTRATION_TTL_MS
        const { registrationResponse } =
          opaqueStep(
            'registrationRequest'
            , () =>
                opaque.server.createRegistrationResponse(
                  { serverSetup
                  , userIdentifier: userId
                  , registrationRequest: body.registrationRequest as string
                  }))

        await insertKey(
          db
          , { id
            , type: 'opaque_registration'
            , jwk: publicJwk
            , expiresAt
            , material:
                JSON.stringify(
                  { username
                  , email
                  , displayName:
                      typeof body.displayName === 'string'
                      && body.displayName.length > 0
                        ? body.displayName
                        : null
                  , userId
                  })
            })

        return (
          { id
          , type: 'opaque_registration'
          , expiresAt: iso(expiresAt)
          , registrationResponse
          , serverPublicKey: generateKeyPair().publicJwk
          })
      }

    const finishRegistration =
      async (id: string, raw: unknown) => {
        await opaque.ready
        const { registrationRecord } = validate(registrationFinish, raw)
        const idValue = keyId(id)

        return await inTransaction(
          db
          , async tx => {
              const now = Date.now()
              const consumed =
                await consume(
                  tx, 'opaque_registration', idValue, now, '`material`')
              const pending = parseStored(consumed.material, 'registration state')
              if (!isObject(pending)
                  || ['username', 'email', 'userId']
                      .some(key => typeof pending[key] !== 'string'))
                throw new Error('Stored registration state is invalid')

              // Reject unusable records now; the throw rolls the consume back.
              opaqueStep(
                'registrationRecord'
                , () =>
                    opaque.server.startLogin(
                      { serverSetup
                      , registrationRecord: registrationRecord as string
                      , startLoginRequest:
                          opaque.client.startLogin({ password: 'probe' })
                            .startLoginRequest
                      , userIdentifier: newUuid()
                      }))

              const userId = uuidToBuffer(pending.userId as string)
              try {
                await tx.run(
                  'INSERT INTO `user` (`id`, `username`, `email`, `display_name`,'
                  + ' `owner`) VALUES (?, ?, ?, ?, ?)'
                  , [ userId
                    , pending.username
                    , pending.email
                    , typeof pending.displayName === 'string'
                        ? pending.displayName
                        : null
                    , userId
                    ])
              } catch (error) {
                throw mapWriteError(error)
              }

              await tx.run(
                'UPDATE `key` SET `material` = ?, `user_id` = ?, `owner` = ?,'
                + ' `expires_at` = NULL, `consumed_at` = ? WHERE `id` = ?'
                , [registrationRecord, userId, userId, now, idValue])

              return (
                { id
                , type: 'opaque_registration'
                , userId: pending.userId
                , consumedAt: iso(now)
                })
            })
      }

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

    const finishKey =
      (id: string, raw: unknown) => {
        if (!isObject(raw))
          throw badRequest('Request body must be a JSON object')

        const registration = Object.hasOwn(raw, 'registrationRecord')
        const login = Object.hasOwn(raw, 'finishLoginRequest')
        if (registration === login)
          throw badRequest(
            registration
              ? 'Provide either "registrationRecord" or "finishLoginRequest", not both'
              : 'Request body must contain "registrationRecord" or "finishLoginRequest"')

        return registration
          ? finishRegistration(id, raw)
          : finishLogin(id, raw)
      }

    const getKey =
      async (id: string) => {
        const idValue = keyId(id)
        await purgeExpired()

        const row =
          await db.get(
            'SELECT `id`, `type`, `expires_at`, `consumed_at`, `user_id`'
            + ' FROM `key` WHERE `id` IN (?, ?) LIMIT 1'
            , [idValue, sessionKeyId(id)])
        if (!row) throw notFound(`Key "${id}" was not found`)

        return (
          { id: canonicalUuid(id)
          , type: row.type
          , expiresAt: iso(row.expires_at)
          , consumedAt: iso(row.consumed_at)
          , userId: row.user_id ? canonicalUuid(row.user_id) : null
          })
      }

    const deleteKey =
      async (id: string) => {
        const result =
          await db.run(
            'DELETE FROM `key` WHERE `id` IN (?, ?)', [keyId(id), sessionKeyId(id)])
        if (result.changes === 0)
          throw notFound(`Key "${id}" was not found`)
      }

    return { startRegistration, startLogin, finishKey, getKey, deleteKey }
  }

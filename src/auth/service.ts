import * as opaque from '@serenity-kit/opaque'
import type { Row, RowDatabase } from '../server/database.ts'
import { badRequest, conflict, notFound, unauthorized } from '../server/errors.ts'
import { quoteIdentifier } from '../server/query.ts'
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

export const REGISTRATION_TTL_MS = 10 * 60 * 1000
export const LOGIN_TTL_MS = 10 * 60 * 1000
export const SESSION_TTL_MS = 24 * 60 * 60 * 1000

type KeyType =
  | 'jwk'
  | 'opaque_registration'
  | 'opaque_login_state'
  | 'session'

type PendingRegistration =
  { username: string
  , email: string
  , displayName: string | null
  , userId: string
  }

export type KeyStatus =
  { id: string
  , type: KeyType
  , expiresAt: string | null
  , consumedAt: string | null
  , userId: string | null
  }

export type RegistrationStart =
  { id: string
  , type: 'opaque_registration'
  , expiresAt: string
  , registrationResponse: string
  , serverPublicKey: PublicJwk
  }

export type RegistrationFinish =
  { id: string
  , type: 'opaque_registration'
  , userId: string
  , consumedAt: string
  }

export type LoginStart =
  { id: string
  , type: 'opaque_login_state'
  , expiresAt: string
  , loginResponse: string
  , serverPublicKey: PublicJwk
  }

export type LoginFinish =
  { sessionId: string
  , type: 'session'
  , expiresAt: string
  , serverPublicKey: PublicJwk
  }

export type AuthService =
  { startRegistration: (body: unknown) => Promise<RegistrationStart>
  , finishRegistration:
      (id: string, body: unknown) => Promise<RegistrationFinish>
  , startLogin: (body: unknown) => Promise<LoginStart>
  , finishLogin: (id: string, body: unknown) => Promise<LoginFinish>
  , finishKey:
      (id: string, body: unknown) => Promise<RegistrationFinish | LoginFinish>
  , getKey: (id: string) => Promise<KeyStatus>
  , deleteKey: (id: string) => Promise<void>
  , purgeExpired: () => Promise<void>
  }

import { isObject } from '../server/guard.ts'



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
    const millis = typeof value === 'number' ? value : Number(value)
    return Number.isFinite(millis) ? new Date(millis).toISOString() : null
  }

const parseStoredJson =
  (value: unknown, label: string) => {
    if (typeof value !== 'string')
      throw new Error(`Stored ${label} is missing`)
    try {
      return JSON.parse(value) as unknown
    } catch {
      throw new Error(`Stored ${label} is not valid JSON`)
    }
  }

const parsePendingRegistration =
  (value: unknown): PendingRegistration => {
    const parsed = parseStoredJson(value, 'registration state')
    if (!isObject(parsed)
        || typeof parsed.username !== 'string'
        || typeof parsed.email !== 'string'
        || typeof parsed.userId !== 'string')
      throw new Error('Stored registration state is invalid')

    return (
      { username: parsed.username
      , email: parsed.email
      , displayName:
          typeof parsed.displayName === 'string' ? parsed.displayName : null
      , userId: parsed.userId
      })
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
  async <T>(
    db: RowDatabase,
    fn: (db: RowDatabase) => Promise<T>): Promise<T> => {
    if (db.transaction) return await db.transaction(fn)
    return await fn(db)
  }

export const createAuthService =
  ( options:
    { db: RowDatabase
    , serverSetup: string
    }): AuthService => {
    const { db, serverSetup } = options

    const purgeExpired =
      async () => {
        await db.run(
          `DELETE FROM ${quoteIdentifier('key')}`
          + ` WHERE ${quoteIdentifier('expires_at')} IS NOT NULL`
          + ` AND ${quoteIdentifier('expires_at')} <= ?`
          , [Date.now()])
      }

    const insertKey =
      async (
        tx: RowDatabase,
        row:
          { id: string
          , type: KeyType
          , jwk?: unknown
          , clientJwk?: unknown
          , material?: string
          , expiresAt?: number | null
          , userId?: string | null
          }) => {
        const userId = row.userId ?? null
        await tx.run(
          `INSERT INTO ${quoteIdentifier('key')}`
          + ` (${quoteIdentifier('id')}`
          + `, ${quoteIdentifier('type')}`
          + `, ${quoteIdentifier('jwk')}`
          + `, ${quoteIdentifier('client_jwk')}`
          + `, ${quoteIdentifier('material')}`
          + `, ${quoteIdentifier('expires_at')}`
          + `, ${quoteIdentifier('user_id')}`
          + `, ${quoteIdentifier('owner')})`
          + ' VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
          , [ uuidToBuffer(row.id)
            , row.type
            , row.jwk === undefined ? null : JSON.stringify(row.jwk)
            , row.clientJwk === undefined ? null : JSON.stringify(row.clientJwk)
            , row.material ?? null
            , row.expiresAt ?? null
            , userId === null ? null : uuidToBuffer(userId)
            , userId === null ? null : uuidToBuffer(userId)
            ])
      }

    const startRegistration =
      async (raw: unknown): Promise<RegistrationStart> => {
        await opaque.ready
        const body = validate(registrationStart, raw)
        const username = body.username as string
        const email = body.email as string
        const displayName =
          typeof body.displayName === 'string' && body.displayName.length > 0
            ? body.displayName
            : null
        const registrationRequest = body.registrationRequest as string
        let publicJwk: PublicJwk
        try {
          publicJwk = parsePublicJwk(body.clientPublicKey)
        } catch (error) {
          throw badRequest(
            error instanceof Error ? error.message : 'clientPublicKey must be an Ed25519 public JWK'
            , 'clientPublicKey')
        }

        await purgeExpired()

        const existing =
          await db.get(
            `SELECT 1 AS found FROM ${quoteIdentifier('user')}`
            + ` WHERE ${quoteIdentifier('username')} = ?`
            + ` OR ${quoteIdentifier('email')} = ? LIMIT 1`
            , [username, email])
        if (existing)
          throw conflict('A user with that username or email already exists')

        const userId = newUuid()
        const keyIdValue = newUuid()
        const expiresAt = Date.now() + REGISTRATION_TTL_MS
        const serverKeyPair = generateKeyPair()

        const { registrationResponse } =
          opaque.server.createRegistrationResponse(
            { serverSetup
            , userIdentifier: userId
            , registrationRequest
            })

        const pending: PendingRegistration =
          { username
          , email
          , displayName
          , userId
          }

        await insertKey(
          db
          , { id: keyIdValue
            , type: 'opaque_registration'
            , jwk: publicJwk
            , material: JSON.stringify(pending)
            , expiresAt
            })

        return (
          { id: keyIdValue
          , type: 'opaque_registration'
          , expiresAt: iso(expiresAt)!
          , registrationResponse
          , serverPublicKey: serverKeyPair.publicJwk
          })
      }

    const finishRegistration =
      async (id: string, raw: unknown): Promise<RegistrationFinish> => {
        await opaque.ready
        const body = validate(registrationFinish, raw)
        const registrationRecord = body.registrationRecord as string
        const idValue = keyId(id)

        return await inTransaction(
          db
          , async tx => {
              const now = Date.now()
              const consumed =
                await tx.get(
                  `UPDATE ${quoteIdentifier('key')}`
                  + ` SET ${quoteIdentifier('consumed_at')} = ?`
                  + ` WHERE ${quoteIdentifier('id')} = ?`
                  + ` AND ${quoteIdentifier('type')} = 'opaque_registration'`
                  + ` AND ${quoteIdentifier('consumed_at')} IS NULL`
                  + ` AND ${quoteIdentifier('expires_at')} IS NOT NULL`
                  + ` AND ${quoteIdentifier('expires_at')} > ?`
                  + ` RETURNING ${quoteIdentifier('material')}`
                  , [now, idValue, now])

              if (!consumed)
                throw unauthorized(
                  'Registration state is invalid, expired, or already used')

              const pending = parsePendingRegistration(consumed.material)
              const userId = pending.userId

              try {
                await tx.run(
                  `INSERT INTO ${quoteIdentifier('user')}`
                  + ` (${quoteIdentifier('id')}`
                  + `, ${quoteIdentifier('username')}`
                  + `, ${quoteIdentifier('email')}`
                  + `, ${quoteIdentifier('display_name')}`
                  + `, ${quoteIdentifier('owner')})`
                  + ' VALUES (?, ?, ?, ?, ?)'
                  , [ uuidToBuffer(userId)
                    , pending.username
                    , pending.email
                    , pending.displayName
                    , uuidToBuffer(userId)
                    ])
              } catch (error) {
                throw mapWriteError(error)
              }

              await tx.run(
                `UPDATE ${quoteIdentifier('key')}`
                + ` SET ${quoteIdentifier('material')} = ?`
                + `, ${quoteIdentifier('user_id')} = ?`
                + `, ${quoteIdentifier('owner')} = ?`
                + `, ${quoteIdentifier('expires_at')} = NULL`
                + `, ${quoteIdentifier('consumed_at')} = ?`
                + ` WHERE ${quoteIdentifier('id')} = ?`
                , [ registrationRecord
                  , uuidToBuffer(userId)
                  , uuidToBuffer(userId)
                  , now
                  , idValue
                  ])

              return (
                { id
                , type: 'opaque_registration'
                , userId
                , consumedAt: iso(now)!
                })
            })
      }

    const startLogin =
      async (raw: unknown): Promise<LoginStart> => {
        await opaque.ready
        const body = validate(loginStart, raw)
        const username = body.username as string
        const startLoginRequest = body.startLoginRequest as string
        let publicJwk: PublicJwk
        try {
          publicJwk = parsePublicJwk(body.clientPublicKey)
        } catch (error) {
          throw badRequest(
            error instanceof Error ? error.message : 'clientPublicKey must be an Ed25519 public JWK'
            , 'clientPublicKey')
        }

        await purgeExpired()

        const user =
          await db.get(
            `SELECT ${quoteIdentifier('id')} FROM ${quoteIdentifier('user')}`
            + ` WHERE ${quoteIdentifier('username')} = ? LIMIT 1`
            , [username])

        let userId: string | null = null
        let registrationRecord: string | null = null

        if (user) {
          const candidate = canonicalUuid(user.id)
          const record =
            await db.get(
              `SELECT ${quoteIdentifier('material')}`
              + ` FROM ${quoteIdentifier('key')}`
              + ` WHERE ${quoteIdentifier('user_id')} = ?`
              + ` AND ${quoteIdentifier('type')} = 'opaque_registration'`
              + ` AND ${quoteIdentifier('consumed_at')} IS NOT NULL`
              + ` AND ${quoteIdentifier('expires_at')} IS NULL`
              + ` AND ${quoteIdentifier('material')} IS NOT NULL`
              + ` ORDER BY ${quoteIdentifier('consumed_at')} DESC LIMIT 1`
              , [uuidToBuffer(candidate)])

          if (typeof record?.material === 'string') {
            userId = candidate
            registrationRecord = record.material
          }
        }

        const userIdentifier = userId ?? newUuid()
        const { loginResponse, serverLoginState } =
          opaque.server.startLogin(
            { serverSetup
            , registrationRecord
            , startLoginRequest
            , userIdentifier
            })

        const keyIdValue = newUuid()
        const expiresAt = Date.now() + LOGIN_TTL_MS
        const serverKeyPair = generateKeyPair()

        await insertKey(
          db
          , { id: keyIdValue
            , type: 'opaque_login_state'
            , jwk: serverKeyPair.privateJwk
            , clientJwk: publicJwk
            , material: serverLoginState
            , expiresAt
            , userId
            })

        return (
          { id: keyIdValue
          , type: 'opaque_login_state'
          , expiresAt: iso(expiresAt)!
          , loginResponse
          , serverPublicKey: serverKeyPair.publicJwk
          })
      }

    const finishLogin =
      async (id: string, raw: unknown): Promise<LoginFinish> => {
        await opaque.ready
        const body = validate(loginFinish, raw)
        const finishLoginRequest = body.finishLoginRequest as string
        const idValue = keyId(id)

        return await inTransaction(
          db
          , async tx => {
              const now = Date.now()
              const login =
                await tx.get(
                  `UPDATE ${quoteIdentifier('key')}`
                  + ` SET ${quoteIdentifier('consumed_at')} = ?`
                  + ` WHERE ${quoteIdentifier('id')} = ?`
                  + ` AND ${quoteIdentifier('type')} = 'opaque_login_state'`
                  + ` AND ${quoteIdentifier('consumed_at')} IS NULL`
                  + ` AND ${quoteIdentifier('expires_at')} IS NOT NULL`
                  + ` AND ${quoteIdentifier('expires_at')} > ?`
                  + ` RETURNING ${quoteIdentifier('user_id')}`
                  + `, ${quoteIdentifier('material')}`
                  + `, ${quoteIdentifier('jwk')}`
                  + `, ${quoteIdentifier('client_jwk')}`
                  , [now, idValue, now])

              if (!login)
                throw unauthorized(
                  'Login state is invalid, expired, or already used')

              if (login.user_id === null || login.user_id === undefined)
                throw unauthorized('Invalid username or password')

              let sessionKey: string
              try {
                sessionKey =
                  opaque.server.finishLogin(
                    { serverLoginState: String(login.material)
                    , finishLoginRequest
                    }).sessionKey
              } catch {
                throw unauthorized('Invalid username or password')
              }

              if (typeof sessionKey !== 'string' || sessionKey.length === 0)
                throw unauthorized('Invalid username or password')

              const privateJwk = parsePrivateJwk(
                parseStoredJson(login.jwk, 'login server key'))
              const clientJwk = parsePublicJwk(
                parseStoredJson(login.client_jwk, 'login client key'))
              const userId = canonicalUuid(login.user_id)
              const sessionId = newUuid()
              const expiresAt = now + SESSION_TTL_MS

              await insertKey(
                tx
                , { id: sessionId
                  , type: 'session'
                  , jwk: privateJwk
                  , clientJwk
                  , material: sessionKey
                  , expiresAt
                  , userId
                  })

              return (
                { sessionId
                , type: 'session'
                , expiresAt: iso(expiresAt)!
                , serverPublicKey: publicJwkFromPrivate(privateJwk)
                })
            })
      }

    const finishKey =
      async (id: string, raw: unknown) => {
        if (!isObject(raw))
          throw badRequest('Request body must be a JSON object')
        const body = raw as Record<string, unknown>
        const hasRegistration = Object.hasOwn(body, 'registrationRecord')
        const hasLogin = Object.hasOwn(body, 'finishLoginRequest')

        if (hasRegistration && hasLogin)
          throw badRequest(
            'Provide either "registrationRecord" or "finishLoginRequest", not both')

        if (hasRegistration) return await finishRegistration(id, body)
        if (hasLogin) return await finishLogin(id, body)

        throw badRequest(
          'Request body must contain "registrationRecord" or "finishLoginRequest"')
      }

    const getKey =
      async (id: string): Promise<KeyStatus> => {
        const idValue = keyId(id)
        await purgeExpired()

        const row: Row | undefined =
          await db.get(
            `SELECT ${quoteIdentifier('id')}`
            + `, ${quoteIdentifier('type')}`
            + `, ${quoteIdentifier('expires_at')}`
            + `, ${quoteIdentifier('consumed_at')}`
            + `, ${quoteIdentifier('user_id')}`
            + ` FROM ${quoteIdentifier('key')}`
            + ` WHERE ${quoteIdentifier('id')} = ? LIMIT 1`
            , [idValue])

        if (!row) throw notFound(`Key "${id}" was not found`)

        return (
          { id: canonicalUuid(row.id)
          , type: row.type as KeyType
          , expiresAt: iso(row.expires_at)
          , consumedAt: iso(row.consumed_at)
          , userId:
              row.user_id === null || row.user_id === undefined
                ? null
                : canonicalUuid(row.user_id)
          })
      }

    const deleteKey =
      async (id: string): Promise<void> => {
        const idValue = keyId(id)
        const result =
          await db.run(
            `DELETE FROM ${quoteIdentifier('key')}`
            + ` WHERE ${quoteIdentifier('id')} = ?`
            , [idValue])

        if (result.changes === 0)
          throw notFound(`Key "${id}" was not found`)
      }

    return (
      { startRegistration
      , finishRegistration
      , startLogin
      , finishLogin
      , finishKey
      , getKey
      , deleteKey
      , purgeExpired
      })
  }

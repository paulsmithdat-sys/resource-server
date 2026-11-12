import type { RowDatabase } from '../../server/database.ts'
import { badRequest, conflict } from '../../server/errors.ts'
import { uuidToBuffer } from '../../server/uuid.ts'
import { parsePublicJwk, type PublicJwk } from '../keys.ts'

const MINUTE = 60_000
export const REGISTRATION_TTL_MS = 10 * MINUTE
export const LOGIN_TTL_MS = 10 * MINUTE
export const SESSION_TTL_MS = 24 * 60 * MINUTE

export type KeyType = 'opaque_registration' | 'opaque_login_state' | 'session'

export type AuthService =
  { startRegistration: (body: unknown, client?: string) => Promise<{ id: string }>
  , startLogin: (body: unknown, client?: string) => Promise<{ id: string }>
  , finishKey: (id: string, body: unknown) => Promise<unknown>
  , getKey: (id: string) => Promise<unknown>
  , deleteKey: (id: string) => Promise<void>
  }

export const keyId =
  (value: string) => {
    try {
      return uuidToBuffer(value)
    } catch {
      throw badRequest('"id" must be a canonical UUID', 'id')
    }
  }

export const iso =
  (value: unknown) => {
    if (value === null || value === undefined) return null
    const millis = Number(value)
    return Number.isFinite(millis) ? new Date(millis).toISOString() : null
  }

export const json =
  (value: unknown) =>
    value === undefined ? null : JSON.stringify(value)

export const parseStored =
  (value: unknown, label: string): unknown => {
    try {
      return JSON.parse(value as string)
    } catch {
      throw new Error(`Stored ${label} is missing or invalid`)
    }
  }

export const clientKey =
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

export const opaqueStep =
  <T>(field: string, step: () => T): T => {
    try {
      return step()
    } catch {
      throw badRequest(`"${field}" is invalid`, field)
    }
  }

export const mapWriteError =
  (error: unknown) => {
    const message = error instanceof Error ? error.message : String(error)
    if (/UNIQUE constraint failed/i.test(message))
      return conflict('A user with that username already exists')
    if (/FOREIGN KEY constraint failed/i.test(message))
      return conflict('The referenced user does not exist')
    return error instanceof Error ? error : new Error(message)
  }

export const inTransaction =
  <T>(db: RowDatabase, fn: (db: RowDatabase) => Promise<T>): Promise<T> =>
    db.transaction ? db.transaction(fn) : fn(db)

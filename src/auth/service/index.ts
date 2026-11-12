import type { RowDatabase } from '../../server/database.ts'
import type { Limits } from '../limits.ts'
import { createDeps } from './deps.ts'
import { keyHandlers } from './keys.ts'
import { loginHandlers } from './login.ts'
import { registrationHandlers } from './registration.ts'

export { LOGIN_TTL_MS, REGISTRATION_TTL_MS, SESSION_TTL_MS } from './helpers.ts'

/** The operations behind the `/key` routes. */
export type AuthService =
  { startRegistration: (body: unknown, client?: string) => Promise<{ id: string }>
  , startLogin: (body: unknown, client?: string) => Promise<{ id: string }>
  , finishKey: (id: string, body: unknown) => Promise<unknown>
  , getKey: (id: string) => Promise<unknown>
  , deleteKey: (id: string) => Promise<void>
  }

/**
 * Create the OPAQUE registration, login and key service.
 *
 * @param options - The database, OPAQUE server setup, optional rate limits and audit flag.
 */
export const createAuthService =
  (options: { db: RowDatabase, serverSetup: string, limits?: Limits, audit?: boolean }): AuthService => {
    // Purpose: assemble the registration, login and key handlers over shared helpers
    const deps = createDeps(options)
    const registration = registrationHandlers(deps)
    const login = loginHandlers(deps)
    const keys = keyHandlers(deps, { ...registration, ...login })
    return { ...registration, ...login, ...keys }
  }

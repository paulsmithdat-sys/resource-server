import { verifySignedRequest } from '../../auth/signing.ts'
import type { AppContext, Next } from '../context.ts'
import type { RowDatabase } from '../database.ts'
import type { Registry } from '../registry.ts'
import { uuidToBuffer } from '../uuid.ts'
import { negotiate, operationOf } from './negotiate.ts'
import { pathParam } from '../context.ts'

/** Settings the request guard needs. */
export type GuardOptions =
  { db: RowDatabase
  , registry: Registry
  /** Lower-cased usernames that always hold the `admin` role. */
  , adminNames: string[]
  /** The session middleware, or undefined when sessions are not enforced. */
  , requireAuth?: (c: AppContext, next: Next) => Promise<void>
  }

/**
 * List the roles a user holds: rows in `user_role` plus the configured admins.
 *
 * @param options - Guard settings.
 * @param userId - The user's canonical UUID.
 */
export const rolesOf =
  async (options: GuardOptions, userId: string): Promise<string[]> => {
    // Purpose: list the roles a user holds, from user_role plus the configured admins
    const { db, registry, adminNames } = options
    if (!registry.get('user_role')) return []
    const user = uuidToBuffer(userId)
    const roles =
      (await db.all('SELECT `role` FROM `user_role` WHERE `user_id` = ?', [user]))
        .map(x => String(x.role))
    if (adminNames.length > 0 && !roles.includes('admin')) {
      const row =
        await db.get(
          'SELECT lower(`username`) AS `name` FROM `user` WHERE `id` = ?', [user])
      if (row && adminNames.includes(String(row.name))) roles.push('admin')
    }
    return roles
  }

/**
 * Build the middleware every resource request passes through. `x-access`
 * read/create `public` allow those operations without a session; a session
 * that is sent is always validated; signed operations need a session and a
 * valid signature.
 */
export const createGuard =
  (options: GuardOptions) => {
    // Purpose: build the middleware that negotiates, authenticates, verifies signatures and loads roles
    const { db, registry, requireAuth } = options
    return async (c: AppContext, next: Next): Promise<Response | void> => {
      const type = pathParam(c, 'type')
      const nested = c.req.param('rel') !== undefined
      negotiate(c, nested, registry.get(type) !== undefined)
      if (!requireAuth) return next()

      const access = registry.get(type)?.access
      const operation = operationOf(c.req.method, nested)
      const signed = access?.signed.includes(operation) === true
      const open =
        !signed
        && ((operation === 'read' && access?.read === 'public')
            || (operation === 'create' && access?.create === 'public'))
      if (open && !c.req.header('authorization')) {
        c.set('anonymous', true)
        return next()
      }
      return requireAuth(c, async () => {
        c.set('signed', await verifySignedRequest(c, db, signed))
        c.set('roles', await rolesOf(options, c.get('userId') ?? ''))
        await next()
      })
    }
  }


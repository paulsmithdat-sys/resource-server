import { sessionKeyId } from '../session-key.ts'
import { badRequest, notFound } from '../../server/errors.ts'
import { isObject } from '../../server/guard.ts'
import { canonicalUuid } from '../../server/uuid.ts'
import type { AuthDeps } from './deps.ts'
import { keyId, iso } from './helpers.ts'

/** The registration and login finishers that {@link keyHandlers} dispatches to. */
export type Finishers =
  { finishRegistration: (id: string, body: Record<string, unknown>) => Promise<unknown>
  , finishLogin: (id: string, body: Record<string, unknown>) => Promise<unknown>
  }

/**
 * Build the handlers behind `POST/PATCH/GET/DELETE /key`.
 *
 * @param deps - The shared helpers.
 * @param finishers - The registration and login finish handlers.
 */
export const keyHandlers =
  ({ db, purgeExpired }: AuthDeps, { finishRegistration, finishLogin }: Finishers) => {
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

    return { finishKey, getKey, deleteKey }
  }

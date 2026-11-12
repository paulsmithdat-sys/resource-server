import * as opaque from '@serenity-kit/opaque'
import { conflict } from '../../server/errors.ts'
import { isObject } from '../../server/guard.ts'
import { newUuid, uuidToBuffer } from '../../server/uuid.ts'
import { generateKeyPair } from '../keys.ts'
import { validate, registrationStart, registrationFinish } from '../validation.ts'
import type { AuthDeps } from './deps.ts'
import { REGISTRATION_TTL_MS, keyId, iso, parseStored, clientKey, opaqueStep, mapWriteError, inTransaction } from './helpers.ts'

/**
 * Build the OPAQUE registration start and finish handlers.
 */
export const registrationHandlers =
  ({ db, serverSetup, throttle, purgeExpired, insertKey, consume }: AuthDeps) => {
    // Purpose: build the OPAQUE registration start and finish handlers
    const startRegistration =
      async (raw: unknown, client = 'unknown') => {
        await opaque.ready
        const body = validate(registrationStart, raw)
        const username = (body.username as string).toLowerCase()
        const publicJwk = clientKey(body)
        await throttle.register(client)

        await purgeExpired()

        if (await db.get(
          'SELECT 1 FROM `user` WHERE lower(`username`) = ? LIMIT 1'
          , [username]))
          throw conflict('A user with that username already exists')

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
                  || ['username', 'userId']
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
                  'INSERT INTO `user` (`id`, `username`, `display_name`, `owner`)'
                  + ' VALUES (?, ?, ?, ?)'
                  , [ userId
                    , pending.username
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

    return { startRegistration, finishRegistration }
  }

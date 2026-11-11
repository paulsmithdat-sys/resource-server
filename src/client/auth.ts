import * as opaque from '@serenity-kit/opaque'
import
  { bytesToBase64Url
  , generateKeyPair
  , type KeyPair
  , type PublicJwk
  } from './crypto.ts'
import { ResourceServerError } from './errors.ts'
import type { HttpClient } from './http.ts'
import type { ResourceServerSession } from './session.ts'

const JSON_HEADERS = { 'content-type': 'application/json' }

export type RegisterInput =
  { username: string
  , password: string
  , displayName?: string
  }

export type LoginInput =
  { username: string
  , password: string
  }

export type RegistrationStartDocument =
  { id: string
  , type: 'opaque_registration'
  , expiresAt: string
  , registrationResponse: string
  , serverPublicKey: PublicJwk
  }

export type RegistrationFinishDocument =
  { id: string
  , type: 'opaque_registration'
  , userId: string
  , consumedAt: string
  }

export type LoginStartDocument =
  { id: string
  , type: 'opaque_login_state'
  , expiresAt: string
  , loginResponse: string
  , serverPublicKey: PublicJwk
  }

export type LoginFinishDocument =
  { sessionId: string
  , userId?: string
  , type: 'session'
  , expiresAt: string
  , serverPublicKey: PublicJwk
  }

export type KeyStatusDocument =
  { id: string
  , type: string
  , expiresAt: string | null
  , consumedAt: string | null
  , userId: string | null
  }

export type RegisterResult =
  { userId: string
  , session: ResourceServerSession | null
  }

export type AuthClient =
  { register: (
      input: RegisterInput
      , options?: { signIn?: boolean }) => Promise<RegisterResult>
  , login: (input: LoginInput) => Promise<ResourceServerSession>
  , logout: (session: ResourceServerSession) => Promise<void>
  , status: (id: string) => Promise<KeyStatusDocument>
  }

const invalidLogin =
  () =>
    new ResourceServerError(
      401, 'Unauthorized', 'Invalid username or password')

const post =
  async <T>(http: HttpClient, path: string, body: unknown) =>
    await http.json<T>(
      path
      , { method: 'POST'
        , headers: JSON_HEADERS
        , body: JSON.stringify(body)
        })

const patch =
  async <T>(http: HttpClient, path: string, body: unknown) =>
    await http.json<T>(
      path
      , { method: 'PATCH'
        , headers: JSON_HEADERS
        , body: JSON.stringify(body)
        })

/**
 * Wraps the OPAQUE registration and login exchanges so callers only deal with
 * usernames, passwords, and a session.
 */
export const createAuth =
  (http: HttpClient): AuthClient => {
    const startRegistration =
      async (input: RegisterInput) => {
        await opaque.ready
        const { clientRegistrationState, registrationRequest } =
          opaque.client.startRegistration({ password: input.password })
        const keyPair = generateKeyPair()

        const document =
          await post<RegistrationStartDocument>(
            http
            , '/key'
            , { type: 'opaque_registration'
              , username: input.username
              , ...(input.displayName === undefined
                  ? {}
                  : { displayName: input.displayName })
              , registrationRequest
              , clientPublicKey: keyPair.publicJwk
              })

        return { document, clientRegistrationState, keyPair, input }
      }

    const finishRegistration =
      async (start: Awaited<ReturnType<typeof startRegistration>>) => {
        await opaque.ready
        const { registrationRecord } =
          opaque.client.finishRegistration(
            { clientRegistrationState: start.clientRegistrationState
            , registrationResponse: start.document.registrationResponse
            , password: start.input.password
            })

        return await patch<RegistrationFinishDocument>(
          http
          , `/key/${start.document.id}`
          , { registrationRecord })
      }

    const status =
      async (id: string) =>
        await http.json<KeyStatusDocument>(`/key/${id}`)

    const startLogin =
      async (input: LoginInput) => {
        await opaque.ready
        const { clientLoginState, startLoginRequest } =
          opaque.client.startLogin({ password: input.password })
        const keyPair = generateKeyPair()

        const document =
          await post<LoginStartDocument>(
            http
            , '/key'
            , { type: 'opaque_login_state'
              , username: input.username
              , startLoginRequest
              , clientPublicKey: keyPair.publicJwk
              })

        return { document, clientLoginState, keyPair, input }
      }

    const finishLogin =
      async (start: Awaited<ReturnType<typeof startLogin>>) => {
        await opaque.ready
        let result: ReturnType<typeof opaque.client.finishLogin>
        try {
          result =
            opaque.client.finishLogin(
              { clientLoginState: start.clientLoginState
              , loginResponse: start.document.loginResponse
              , password: start.input.password
              })
        } catch {
          throw invalidLogin()
        }

        if (!result) throw invalidLogin()

        const document =
          await patch<LoginFinishDocument>(
            http
            , `/key/${start.document.id}`
            , { finishLoginRequest: result.finishLoginRequest })

        return { document, keyPair: start.keyPair }
      }

    const toSession =
      async (start: Awaited<ReturnType<typeof startLogin>>) => {
        const finish = await finishLogin(start)
        const userId =
          finish.document.userId
          ?? (await status(finish.document.sessionId)).userId

        if (!userId)
          throw new ResourceServerError(
            500, 'Internal Server Error', 'Session is not associated with a user')

        const session: ResourceServerSession =
          { sessionId: finish.document.sessionId
          , userId
          , expiresAt: finish.document.expiresAt
          , clientPublicKey: finish.keyPair.publicJwk
          , serverPublicKey: finish.document.serverPublicKey
          , secretKey: bytesToBase64Url(finish.keyPair.secretKey)
          }

        return session
      }

    const login =
      async (input: LoginInput) =>
        await toSession(await startLogin(input))

    const register =
      async (input: RegisterInput, options: { signIn?: boolean } = {}) => {
        const finish = await finishRegistration(await startRegistration(input))
        const session =
          options.signIn === false
            ? null
            : await login(
                { username: input.username, password: input.password })

        return { userId: finish.userId, session }
      }

    const logout =
      async (session: ResourceServerSession) => {
        const response =
          await http.request(
            `/key/${session.sessionId}`, { method: 'DELETE' })
        // Logging out an already-gone session is not an error.
        if (response.status === 404) return
        await http.expectOk(response)
      }

    return { register, login, logout, status }
  }

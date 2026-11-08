import * as opaque from '@serenity-kit/opaque'
import type { Hono } from 'hono'
import { generateKeyPair } from '../../src/auth/keys.ts'

export type AuthResponse<T> =
  { response: Response
  , document: T
  }

const post =
  async <T>(app: Hono, path: string, body: unknown) => {
    const response =
      await app.request(
        path
        , { method: 'POST'
          , headers: { 'content-type': 'application/json' }
          , body: JSON.stringify(body)
          })
    const document = await response.json() as T
    return { response, document }
  }

const patch =
  async <T>(app: Hono, path: string, body: unknown) => {
    const response =
      await app.request(
        path
        , { method: 'PATCH'
          , headers: { 'content-type': 'application/json' }
          , body: JSON.stringify(body)
          })
    const document = await response.json() as T
    return { response, document }
  }

export type RegistrationStartDocument =
  { id: string
  , type: 'opaque_registration'
  , expiresAt: string
  , registrationResponse: string
  , serverPublicKey:
      { kty: string; crv: string; x: string }
  }

export type LoginStartDocument =
  { id: string
  , type: 'opaque_login_state'
  , expiresAt: string
  , loginResponse: string
  , serverPublicKey:
      { kty: string; crv: string; x: string }
  }

export type RegistrationFinishDocument =
  { id: string
  , type: 'opaque_registration'
  , userId: string
  , consumedAt: string
  }

export type LoginFinishDocument =
  { sessionId: string
  , type: 'session'
  , expiresAt: string
  , serverPublicKey:
      { kty: string; crv: string; x: string }
  }

export type KeyStatusDocument =
  { id: string
  , type: string
  , expiresAt: string | null
  , consumedAt: string | null
  , userId: string | null
  }

export const startRegistration =
  async (
    app: Hono,
    input:
      { username: string
      , email: string
      , password: string
      , displayName?: string
      }) => {
    const { clientRegistrationState, registrationRequest } =
      opaque.client.startRegistration({ password: input.password })
    const clientKeyPair = generateKeyPair()

    const result =
      await post<RegistrationStartDocument>(
        app
        , '/key'
        , { type: 'opaque_registration'
          , username: input.username
          , email: input.email
          , displayName: input.displayName
          , registrationRequest
          , clientPublicKey: clientKeyPair.publicJwk
          })

    return {
      ...result,
      clientRegistrationState,
      clientKeyPair,
      input,
    }
  }

export const finishRegistration =
  async (
    app: Hono,
    start: Awaited<ReturnType<typeof startRegistration>>) => {
    const { registrationRecord } =
      opaque.client.finishRegistration(
        { clientRegistrationState: start.clientRegistrationState
        , registrationResponse: start.document.registrationResponse
        , password: start.input.password
        })

    return await patch<RegistrationFinishDocument>(
      app
      , `/key/${start.document.id}`
      , { registrationRecord })
  }

export const register =
  async (
    app: Hono,
    input:
      { username: string
      , email: string
      , password: string
      , displayName?: string
      }) => {
    const start = await startRegistration(app, input)
    if (start.response.status !== 201)
      throw new Error(
        `Registration start failed: ${start.response.status} `
        + JSON.stringify(start.document))

    const finish = await finishRegistration(app, start)
    if (finish.response.status !== 200)
      throw new Error(
        `Registration finish failed: ${finish.response.status} `
        + JSON.stringify(finish.document))

    return { start, finish, userId: finish.document.userId }
  }

export type LoginAttempt =
  { start: Awaited<ReturnType<typeof startLogin>>
  , finish?: Awaited<ReturnType<typeof finishLogin>>
  , sessionKey?: string
  }

export const startLogin =
  async (
    app: Hono,
    input: { username: string; password: string }) => {
    const { clientLoginState, startLoginRequest } =
      opaque.client.startLogin({ password: input.password })
    const clientKeyPair = generateKeyPair()

    const result =
      await post<LoginStartDocument>(
        app
        , '/key'
        , { type: 'opaque_login_state'
          , username: input.username
          , startLoginRequest
          , clientPublicKey: clientKeyPair.publicJwk
          })

    return {
      ...result,
      clientLoginState,
      clientKeyPair,
      input,
    }
  }

export const finishLogin =
  async (
    app: Hono,
    start: Awaited<ReturnType<typeof startLogin>>) => {
    const loginResult =
      opaque.client.finishLogin(
        { clientLoginState: start.clientLoginState
        , loginResponse: start.document.loginResponse
        , password: start.input.password
        })

    if (!loginResult) return undefined

    const result =
      await patch<LoginFinishDocument>(
        app
        , `/key/${start.document.id}`
        , { finishLoginRequest: loginResult.finishLoginRequest })

    return { ...result, sessionKey: loginResult.sessionKey }
  }

export const login =
  async (app: Hono, input: { username: string; password: string }) => {
    const start = await startLogin(app, input)
    if (start.response.status !== 201)
      throw new Error(
        `Login start failed: ${start.response.status} `
        + JSON.stringify(start.document))

    const finish = await finishLogin(app, start)
    if (!finish)
      throw new Error('Client login failed')
    if (finish.response.status !== 200)
      throw new Error(
        `Login finish failed: ${finish.response.status} `
        + JSON.stringify(finish.document))

    return { start, finish, sessionKey: finish.sessionKey }
  }

export const getKey =
  async (app: Hono, id: string) => {
    const response = await app.request(`/key/${id}`)
    return {
      response,
      document: await response.json() as KeyStatusDocument,
    }
  }

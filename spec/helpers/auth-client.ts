import * as opaque from '@serenity-kit/opaque'
import type { Hono } from 'hono'
import { generateKeyPair } from '../../src/auth/keys.ts'

export const JSON_HEADERS = { 'content-type': 'application/json' }

export type AuthResponse<T> =
  { response: Response
  , document: T
  }

export const authCredentials =
  { username: 'alice'
  , password: 'correct horse battery staple'
  , displayName: 'Alice'
  }

export const credentials =
  (overrides: Partial<typeof authCredentials> = {}) =>
    ({ ...authCredentials, ...overrides })

const post =
  async <T>(app: Hono, path: string, body: unknown) => {
    const response =
      await app.request(
        path
        , { method: 'POST'
          , headers: JSON_HEADERS
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
          , headers: JSON_HEADERS
          , body: JSON.stringify(body)
          })
    const document = await response.json() as T
    return { response, document }
  }

export const postKey =
  async (app: Hono, body: unknown) =>
    await app.request(
      '/key'
      , { method: 'POST'
        , headers: JSON_HEADERS
        , body: JSON.stringify(body)
        })

export const patchKey =
  async (app: Hono, id: string, body: unknown) =>
    await app.request(
      `/key/${id}`
      , { method: 'PATCH'
        , headers: JSON_HEADERS
        , body: JSON.stringify(body)
        })

export const deleteKey =
  async (app: Hono, id: string) =>
    await app.request(`/key/${id}`, { method: 'DELETE' })

export const headKey =
  async (app: Hono, id: string) =>
    await app.request(`/key/${id}`, { method: 'HEAD' })

export const optionsKey =
  async (app: Hono, id?: string) =>
    await app.request(id ? `/key/${id}` : '/key', { method: 'OPTIONS' })

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
  , userId: string
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

export const completeClientRegistration =
  (start: Awaited<ReturnType<typeof startRegistration>>) =>
    opaque.client.finishRegistration(
      { clientRegistrationState: start.clientRegistrationState
      , registrationResponse: start.document.registrationResponse
      , password: start.input.password
      }).registrationRecord

export const sendFinishRegistration =
  async (
    app: Hono,
    id: string,
    registrationRecord: string) =>
    await patch<RegistrationFinishDocument>(
      app, `/key/${id}`, { registrationRecord })

export const finishRegistration =
  async (
    app: Hono,
    start: Awaited<ReturnType<typeof startRegistration>>) =>
    await sendFinishRegistration(
      app, start.document.id, completeClientRegistration(start))

export const register =
  async (
    app: Hono,
    input:
      { username: string
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

export const completeClientLogin =
  (start: Awaited<ReturnType<typeof startLogin>>) =>
    opaque.client.finishLogin(
      { clientLoginState: start.clientLoginState
      , loginResponse: start.document.loginResponse
      , password: start.input.password
      })

export const sendFinishLogin =
  async (
    app: Hono,
    id: string,
    finishLoginRequest: string) =>
    await patch<LoginFinishDocument>(
      app, `/key/${id}`, { finishLoginRequest })

export const finishLogin =
  async (
    app: Hono,
    start: Awaited<ReturnType<typeof startLogin>>) => {
    const loginResult = completeClientLogin(start)

    if (!loginResult) return undefined

    const result =
      await sendFinishLogin(
        app, start.document.id, loginResult.finishLoginRequest)

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

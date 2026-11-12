/**
 * Browser and Node client for a resource server: OPAQUE registration and
 * login, session storage, JSON:API requests and optional request signing.
 *
 * @packageDocumentation
 */
import
  { createAuth
  , type AuthClient
  , type KeyStatusDocument
  , type LoginInput
  , type RegisterInput
  , type RegisterResult
  } from './auth.ts'
import
  { randomNonce
  , sign
  , signingMessage
  , type PrivateJwk
  , type PublicJwk
  } from './crypto.ts'
import { ResourceServerError } from './errors.ts'
import { createHttp, type FetchLike } from './http.ts'
import
  { browserStorage
  , createSessionStore
  , memoryStorage
  , type ResourceServerSession
  , type SessionStorage
  } from './session.ts'

export { ResourceServerError } from './errors.ts'
export { createHttp, type FetchLike, type HttpClient, type HttpOptions } from './http.ts'
export
  { browserStorage
  , memoryStorage
  , SESSION_STORAGE_KEY
  , type ResourceServerSession
  , type SessionStorage
  } from './session.ts'
export type { PrivateJwk, PublicJwk } from './crypto.ts'
export type
  { KeyStatusDocument
  , LoginInput
  , RegisterInput
  , RegisterResult
  } from './auth.ts'

/** Options for one client request: the usual fetch options plus whether to sign it. */
export type ClientRequestInit =
  RequestInit & { signed?: boolean }

/** Settings for creating a client: server address, fetch implementation, session storage and automatic signing. */
export type ResourceServerClientOptions =
  { baseUrl?: string
  , fetch?: FetchLike
  , storage?: SessionStorage | null
  , autoSign?: boolean
  }

const JSON_API = 'application/vnd.api+json'

const bodyBytes =
  (body: RequestInit['body']) => {
    if (body === null || body === undefined) return new Uint8Array()
    if (typeof body === 'string') return new TextEncoder().encode(body)
    if (body instanceof Uint8Array) return body
    if (body instanceof ArrayBuffer) return new Uint8Array(body)
    if (ArrayBuffer.isView(body))
      return new Uint8Array(
        body.buffer, body.byteOffset, body.byteLength)
    throw new ResourceServerError(
      400, 'Bad Request', 'Signed requests need a string or byte body')
  }

/** A client for a resource-server: sign-in, session handling and JSON:API requests that are signed when the server requires it. */
export type ResourceServerClient = {
  /** Create an account, and sign in unless `signIn` is false. */
  register: (
    input: RegisterInput
    , options?: { signIn?: boolean }) => Promise<RegisterResult>
  /** Sign in with username and password. */
  login: (input: LoginInput) => Promise<ResourceServerSession>
  /** End the session on the server and forget it locally. */
  logout: () => Promise<void>
  /** The saved session, or null when there is none. */
  restore: () => ResourceServerSession | null
  /** Look up the state of a key by id. */
  status: (id: string) => Promise<KeyStatusDocument>
  /** Send a request with the session attached, signing it when asked. */
  request: (path: string, init?: ClientRequestInit) => Promise<Response>
  /** GET a path and return the JSON body. */
  get: <T = unknown>(
    path: string
    , init?: ClientRequestInit) => Promise<T>
  /** POST a JSON body and return the JSON response. */
  post: <T = unknown>(
    path: string
    , body: unknown
    , init?: ClientRequestInit) => Promise<T>
  /** PATCH a path with a JSON body and return the JSON response. */
  patch: <T = unknown>(
    path: string
    , body: unknown
    , init?: ClientRequestInit) => Promise<T>
  /** PUT a JSON body and return the JSON response. */
  put: <T = unknown>(
    path: string
    , body: unknown
    , init?: ClientRequestInit) => Promise<T>
  /** DELETE a path. */
  delete: (path: string, init?: ClientRequestInit) => Promise<void>
  /** The current session, or null when signed out. */
  readonly session: ResourceServerSession | null
  /** Whether a session is held. */
  readonly isSignedIn: boolean
}

const jsonApiHeaders =
  (headers: RequestInit['headers'], withBody: boolean) => {
    const value = new Headers(headers)
    value.set('accept', JSON_API)
    if (withBody) value.set('content-type', JSON_API)
    return value
  }

/**
 * Creates a client for one resource server. It owns the OPAQUE exchange,
 * session storage, bearer headers, and optional request signing.
 */
export const createResourceServerClient =
  (options: ResourceServerClientOptions = {}): ResourceServerClient => {
    const storage =
      options.storage === undefined ? browserStorage() : options.storage
    const store = createSessionStore(storage)
    const http = createHttp({ baseUrl: options.baseUrl, fetch: options.fetch })
    const auth: AuthClient = createAuth(http)
    const autoSign = options.autoSign === true

    const request =
      async (path: string, init: ClientRequestInit = {}) => {
        const { signed = autoSign, ...rest } = init
        const headers = new Headers(rest.headers)
        const current = store.load()

        if (current)
          headers.set('authorization', `Bearer ${current.sessionId}`)

        if (signed) {
          if (!current)
            throw new ResourceServerError(
              401, 'Unauthorized', 'A session is required to sign requests')

          const url = http.resolve(path)
          const timestamp = String(Date.now())
          const nonce = randomNonce()
          const message =
            await signingMessage(
              { method: rest.method ?? 'GET'
              , path: url.pathname + url.search
              , sessionId: current.sessionId
              , timestamp
              , nonce
              , body: bodyBytes(rest.body)
              })

          headers.set('x-serber-timestamp', timestamp)
          headers.set('x-serber-nonce', nonce)
          headers.set(
            'x-serber-signature', sign(message, current.secretKey))
        }

        return await http.request(path, { ...rest, headers })
      }

    const parse =
      async <T>(response: Response) => {
        await http.expectOk(response)
        if (response.status === 204) return undefined as T
        return await response.json() as T
      }

    const get =
      async <T = unknown>(path: string, init: ClientRequestInit = {}) =>
        await parse<T>(
          await request(
            path
            , { ...init
              , method: 'GET'
              , headers: jsonApiHeaders(init.headers, false)
              }))

    const send =
      async <T = unknown>(
        method: string
        , path: string
        , body: unknown
        , init: ClientRequestInit = {}) =>
        await parse<T>(
          await request(
            path
            , { ...init
              , method
              , headers: jsonApiHeaders(init.headers, true)
              , body: JSON.stringify(body)
              }))

    const post =
      async <T = unknown>(
        path: string, body: unknown, init: ClientRequestInit = {}) =>
        await send<T>('POST', path, body, init)

    const patch =
      async <T = unknown>(
        path: string, body: unknown, init: ClientRequestInit = {}) =>
        await send<T>('PATCH', path, body, init)

    const put =
      async <T = unknown>(
        path: string, body: unknown, init: ClientRequestInit = {}) =>
        await send<T>('PUT', path, body, init)

    const remove =
      async (path: string, init: ClientRequestInit = {}) => {
        const response =
          await request(
            path
            , { ...init
              , method: 'DELETE'
              , headers: jsonApiHeaders(init.headers, false)
              })
        await http.expectOk(response)
      }

    const register =
      async (input: RegisterInput, settings: { signIn?: boolean } = {}) => {
        const result = await auth.register(input, settings)
        if (result.session) store.save(result.session)
        return result
      }

    const login =
      async (input: LoginInput) => {
        const session = await auth.login(input)
        store.save(session)
        return session
      }

    const logout =
      async () => {
        const session = store.load()
        // Clear locally first: the caller is signed out even if the user is
        // offline by the time this runs.
        store.clear()
        if (session) await auth.logout(session)
      }

    return (
      { register
      , login
      , logout
      , restore: () => store.load()
      , status: auth.status
      , request
      , get
      , post
      , patch
      , put
      , delete: remove
      , get session() {
          return store.load()
        }
      , get isSignedIn() {
          return store.load() !== null
        }
      })
  }

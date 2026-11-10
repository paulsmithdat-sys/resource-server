import type { Hono } from 'hono'
import nacl from 'tweetnacl'
import
  { NONCE_HEADER
  , SIGNATURE_HEADER
  , TIMESTAMP_HEADER
  , signingMessage
  } from '../../src/auth/signing.ts'
import { login, register } from './auth-client.ts'
import { JSON_API } from './test-server.ts'

export const PASSWORD = 'correct horse battery staple'

export type SignedIn =
  { name: string
  , userId: string
  , sessionId: string
  , secretKey: Uint8Array
  , request:
      ( method: string
      , path: string
      , body?: unknown) => Promise<Response>
  }

export const bearer =
  (sessionId: string) => {
    // Purpose: build an Authorization header value for a session id
    return `Bearer ${sessionId}`
  }

export const requestAs =
  ( app: Hono
  , sessionId: string
  , method: string
  , path: string
  , body?: unknown) => {
    // Purpose: send a JSON:API request carrying the given session id
    const headers: Record<string, string> =
      { authorization: bearer(sessionId), accept: JSON_API }
    const init: RequestInit = { method, headers }
    if (body !== undefined) {
      headers['content-type'] = JSON_API
      init.body = JSON.stringify(body)
    }
    return Promise.resolve(app.request(path, init))
  }

export const signIn =
  async (app: Hono, name: string): Promise<SignedIn> => {
    // Purpose: register a user, log in, and return a session-bound client
    const input =
      { username: name
      , email: `${name}@example.com`
      , password: PASSWORD
      , displayName: name
      }
    const { userId } = await register(app, input)
    const session = await login(app, { username: name, password: PASSWORD })
    const sessionId = session.finish.document.sessionId

    return (
      { name
      , userId
      , sessionId
      , secretKey: session.start.clientKeyPair.secretKey
      , request: (method, path, body) =>
          requestAs(app, sessionId, method, path, body)
      })
  }

export const resourceDocument =
  ( type: string
  , attributes: Record<string, unknown>
  , relationships?: Record<string, unknown>) => {
    // Purpose: wrap attributes and relationships in a JSON:API write document
    return (
      { data:
        { type
        , attributes
        , ...(relationships ? { relationships } : {})
        }
      })
  }

export const toOne =
  (type: string, id: string) => {
    // Purpose: build a to-one JSON:API relationship linkage
    return { data: { type, id } }
  }

export const toMany =
  (type: string, ids: string[]) => {
    // Purpose: build a to-many JSON:API relationship linkage
    return { data: ids.map(id => ({ type, id })) }
  }

export const createAs =
  async (
    user: SignedIn,
    type: string,
    attributes: Record<string, unknown>,
    relationships?: Record<string, unknown>) => {
    // Purpose: create a resource as a user and return its id, failing loudly
    const response =
      await user.request(
        'POST', `/${type}`, resourceDocument(type, attributes, relationships))
    const body = await response.json() as any
    if (response.status !== 201)
      throw new Error(
        `Create ${type} as ${user.name} failed: ${response.status} `
        + JSON.stringify(body))
    return body.data.id as string
  }

export const createArticleAs =
  (user: SignedIn, heading = 'A heading', relationships?: Record<string, unknown>) => {
    // Purpose: create an article owned by the given user
    return createAs(
      user, 'article', { heading, content: 'Some content' }, relationships)
  }

export const createTagAs =
  (user: SignedIn, name = 'a-tag') => {
    // Purpose: create a tag owned by the given user
    return createAs(user, 'tag', { name, kind: 'topic' })
  }

export const signedRequestAs =
  (app: Hono, user: SignedIn, method: string, path: string, body?: unknown) => {
    // Purpose: send a request signed with the user's session key
    const text = body === undefined ? '' : JSON.stringify(body)
    const timestamp = String(Date.now())
    const nonce = Buffer.from(nacl.randomBytes(16)).toString('base64url')
    const message =
      signingMessage(
        { method
        , path
        , sessionId: user.sessionId
        , timestamp
        , nonce
        , body: new TextEncoder().encode(text)
        })
    return app.request(
      path
      , { method
        , headers:
          { authorization: bearer(user.sessionId)
          , accept: JSON_API
          , 'content-type': JSON_API
          , [SIGNATURE_HEADER]:
              Buffer.from(nacl.sign.detached(message, user.secretKey)).toString('base64url')
          , [TIMESTAMP_HEADER]: timestamp
          , [NONCE_HEADER]: nonce
          }
        , ...(body === undefined ? {} : { body: text })
        })
  }

import { describe, expect, test } from 'bun:test'
import nacl from 'tweetnacl'
import
  { NONCE_HEADER
  , SIGNATURE_HEADER
  , TIMESTAMP_HEADER
  , signingMessage
  } from '../src/auth/signing.ts'
import { postKey, register, credentials } from './helpers/auth-client.ts'
import * as opaque from '@serenity-kit/opaque'
import { bearer, resourceDocument, signIn, type SignedIn } from './helpers/session.ts'
import { createTestServer, JSON_API } from './helpers/test-server.ts'

type Options =
  { timestamp?: number
  , nonce?: string
  , signPath?: string
  , signBody?: string
  , key?: Uint8Array
  }

const signed =
  (app: any, user: SignedIn, method: string, path: string, body?: unknown, options: Options = {}) => {
    // Purpose: send a request signed with the user's session key (options let tests tamper)
    const text = body === undefined ? '' : JSON.stringify(body)
    const timestamp = String(options.timestamp ?? Date.now())
    const nonce = options.nonce ?? Buffer.from(nacl.randomBytes(16)).toString('base64url')
    const message =
      signingMessage(
        { method
        , path: options.signPath ?? path
        , sessionId: user.sessionId
        , timestamp
        , nonce
        , body: new TextEncoder().encode(options.signBody ?? text)
        })
    const signature =
      Buffer.from(nacl.sign.detached(message, options.key ?? user.secretKey)).toString('base64url')
    return app.request(
      path
      , { method
        , headers:
          { authorization: bearer(user.sessionId)
          , accept: JSON_API
          , 'content-type': JSON_API
          , [SIGNATURE_HEADER]: signature
          , [TIMESTAMP_HEADER]: timestamp
          , [NONCE_HEADER]: nonce
          }
        , ...(body === undefined ? {} : { body: text })
        })
  }

const payment =
  (amount = 100) => resourceDocument('payment', { amount, currency: 'NZD' })

describe('signed requests', () => {
  test('signed operations reject unsigned requests and accept signed ones', async () => {
    const { app } = await createTestServer({ session: true })
    const alice = await signIn(app, 'alice')

    expect((await alice.request('POST', '/payment', payment())).status).toBe(401)
    const created = await signed(app, alice, 'POST', '/payment', payment())
    expect(created.status).toBe(201)
    const id = ((await created.json()) as any).data.id

    // Reads are not in the signed list, so a plain session is enough.
    expect((await alice.request('GET', `/payment/${id}`)).status).toBe(200)

    const body = { data: { type: 'payment', id, attributes: { amount: 5 } } }
    expect((await alice.request('PATCH', `/payment/${id}`, body)).status).toBe(401)
    expect((await signed(app, alice, 'PATCH', `/payment/${id}`, body)).status).toBe(200)
    expect((await alice.request('DELETE', `/payment/${id}`)).status).toBe(401)
    expect((await signed(app, alice, 'DELETE', `/payment/${id}`)).status).toBe(204)
  })

  test('a replayed request is rejected', async () => {
    const { app } = await createTestServer({ session: true })
    const alice = await signIn(app, 'alice')
    const options = { nonce: 'same-nonce-1234567890', timestamp: Date.now() }

    expect((await signed(app, alice, 'POST', '/payment', payment(), options)).status).toBe(201)
    expect((await signed(app, alice, 'POST', '/payment', payment(), options)).status).toBe(401)
  })

  test('tampered body, path, or another key fail', async () => {
    const { app } = await createTestServer({ session: true })
    const alice = await signIn(app, 'alice')

    const tamperedBody = await signed(app, alice, 'POST', '/payment', payment(1_000_000), { signBody: JSON.stringify(payment(1)) })
    expect(tamperedBody.status).toBe(401)
    const tamperedPath = await signed(app, alice, 'POST', '/payment', payment(), { signPath: '/payment?x=1' })
    expect(tamperedPath.status).toBe(401)
    const otherKey = await signed(app, alice, 'POST', '/payment', payment(), { key: nacl.sign.keyPair().secretKey })
    expect(otherKey.status).toBe(401)
  })

  test('a signature from one session cannot be used with another', async () => {
    const { app } = await createTestServer({ session: true })
    const alice = await signIn(app, 'alice')
    const bob = await signIn(app, 'bob')

    const forBob = { ...alice, sessionId: bob.sessionId }
    expect((await signed(app, forBob, 'POST', '/payment', payment())).status).toBe(401)
  })

  test('timestamps outside the window are rejected', async () => {
    const { app } = await createTestServer({ session: true })
    const alice = await signIn(app, 'alice')

    for (const offset of [-61_000, 61_000]) {
      const response = await signed(app, alice, 'POST', '/payment', payment(), { timestamp: Date.now() + offset })
      expect({ offset, status: response.status }).toEqual({ offset, status: 401 })
    }
    expect((await signed(app, alice, 'POST', '/payment', payment(), { timestamp: Date.now() - 30_000 })).status).toBe(201)
  })

  test('short or malformed nonces are rejected', async () => {
    const { app } = await createTestServer({ session: true })
    const alice = await signIn(app, 'alice')

    for (const nonce of ['short', 'has spaces in it ok?', 'x'.repeat(129)]) {
      const response = await signed(app, alice, 'POST', '/payment', payment(), { nonce })
      expect({ nonce: nonce.slice(0, 10), status: response.status }).toEqual({ nonce: nonce.slice(0, 10), status: 401 })
    }
  })

  test('an invalid signature is rejected even where signing is optional', async () => {
    const { app } = await createTestServer({ session: true })
    const alice = await signIn(app, 'alice')
    const body = resourceDocument('article', { heading: 'Hello', content: 'x' })

    expect((await signed(app, alice, 'POST', '/article', body)).status).toBe(201)
    const bad = await signed(app, alice, 'POST', '/article', body, { key: nacl.sign.keyPair().secretKey })
    expect(bad.status).toBe(401)
  })

  test('a session logged in without a client key cannot sign', async () => {
    const { app } = await createTestServer({ session: true })
    await register(app, credentials())
    const { clientLoginState, startLoginRequest } =
      opaque.client.startLogin({ password: credentials().password })
    const start =
      await postKey(app, { type: 'opaque_login_state', username: 'alice', startLoginRequest })
    expect(start.status).toBe(201)
    const startDoc = await start.json() as any
    const finish =
      opaque.client.finishLogin(
        { clientLoginState, loginResponse: startDoc.loginResponse, password: credentials().password })!
    const done =
      await app.request(`/key/${startDoc.id}`
        , { method: 'PATCH', headers: { 'content-type': 'application/json' }
          , body: JSON.stringify({ finishLoginRequest: finish.finishLoginRequest }) })
    expect(done.status).toBe(200)
    const sessionId = ((await done.json()) as any).sessionId

    const user = { sessionId, secretKey: nacl.sign.keyPair().secretKey } as SignedIn
    expect((await signed(app, user, 'POST', '/payment', payment())).status).toBe(401)
    const plain =
      await app.request('/article'
        , { headers: { authorization: bearer(sessionId) } })
    expect(plain.status).toBe(200)
  })

  test('signed operations are never open to anonymous requests', async () => {
    const { app } = await createTestServer({ session: true })
    const response =
      await app.request('/payment'
        , { method: 'POST', headers: { 'content-type': JSON_API }, body: JSON.stringify(payment()) })
    expect(response.status).toBe(401)
  })
})

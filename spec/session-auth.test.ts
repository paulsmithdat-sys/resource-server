import { sessionKeyId } from '../src/auth/session-key.ts'
import { describe, expect, test } from 'bun:test'
import { uuidToBuffer } from '../src/server/uuid.ts'
import
  { credentials
  , deleteKey
  , login
  , register
  , startLogin
  , startRegistration
  } from './helpers/auth-client.ts'
import { bearer, createArticleAs, signIn } from './helpers/session.ts'
import { createTestServer } from './helpers/test-server.ts'

const withHeader =
  (app: any, method: string, path: string, authorization?: string) => {
    // Purpose: send a bare request with an optional Authorization header
    return app.request(
      path
      , { method
        , headers: authorization === undefined ? {} : { authorization }
        })
  }

describe('bearer session handling', () => {
  test('rejects every non-Bearer or malformed Authorization header with 401', async () => {
    const { app } = await createTestServer({ session: true })
    const alice = await signIn(app, 'alice')

    const headers =
      [ `Basic ${alice.sessionId}`
      , alice.sessionId
      , 'Bearer'
      , 'Bearer '
      , 'Bearer not-a-uuid'
      , `Bearer ${alice.sessionId}x`
      , `Bearer ${alice.sessionId} extra`
      , "Bearer ' OR 1=1 --"
      ]

    for (const header of headers) {
      const response = await withHeader(app, 'GET', '/article', header)
      expect({ header, status: response.status }).toEqual({ header, status: 401 })
    }
  })

  test('accepts a well-formed session id in upper case', async () => {
    const { app } = await createTestServer({ session: true })
    const alice = await signIn(app, 'alice')

    const response =
      await withHeader(
        app, 'GET', '/article', bearer(alice.sessionId.toUpperCase()))
    expect(response.status).toBe(200)
  })

  test('does not accept the session id from the query string', async () => {
    const { app } = await createTestServer({ session: true })
    const alice = await signIn(app, 'alice')

    for (const name of ['access_token', 'session', 'sessionId', 'token']) {
      const response =
        await app.request(`/article?${name}=${alice.sessionId}`)
      expect(response.status).toBe(401)
    }
  })

  test('requires a session for HEAD and OPTIONS on resources', async () => {
    const { app } = await createTestServer({ session: true })
    const alice = await signIn(app, 'alice')
    const id = await createArticleAs(alice)

    for (const path of ['/article', `/article/${id}`])
      for (const method of ['HEAD', 'OPTIONS'])
        expect((await withHeader(app, method, path)).status).toBe(401)
  })

  test('answers 401 before 404 so unknown resource types cannot be probed', async () => {
    const { app } = await createTestServer({ session: true })
    const alice = await signIn(app, 'alice')

    expect((await withHeader(app, 'GET', '/nonexistent')).status).toBe(401)
    expect((await withHeader(app, 'GET', '/nonexistent/abc')).status).toBe(401)
    expect((await alice.request('GET', '/nonexistent')).status).toBe(404)
  })

  test('rejects registration and login-state ids used as bearer tokens', async () => {
    const { app } = await createTestServer({ session: true })

    const pendingRegistration =
      await startRegistration(app, credentials({ username: 'carol', email: 'carol@example.com' }))
    const finished = await register(app, credentials())
    const loginStart = await startLogin(app, { username: 'alice', password: credentials().password })

    const ids =
      [ pendingRegistration.document.id
      , finished.start.document.id
      , loginStart.document.id
      ]
    for (const id of ids) {
      const response = await withHeader(app, 'GET', '/article', bearer(id))
      expect({ id, status: response.status }).toEqual({ id, status: 401 })
    }
  })

  test('rejects a session id that was never issued', async () => {
    const { app } = await createTestServer({ session: true })
    await signIn(app, 'alice')

    const response =
      await withHeader(
        app, 'GET', '/article', bearer('01940000-0000-7000-8000-00000000dead'))
    expect(response.status).toBe(401)
  })

  test('rejects an expired session on every method and keeps other sessions valid', async () => {
    const { app, db } = await createTestServer({ session: true })
    const alice = await signIn(app, 'alice')
    const id = await createArticleAs(alice)
    const second = await login(app, { username: 'alice', password: credentials().password })

    await db.run(
      'UPDATE `key` SET `expires_at` = ? WHERE `id` = ?'
      , [Date.now() - 1, sessionKeyId(alice.sessionId)])

    for (const [method, path] of
      [ ['GET', '/article']
      , ['GET', `/article/${id}`]
      , ['HEAD', `/article/${id}`]
      , ['POST', '/article']
      , ['PATCH', `/article/${id}`]
      , ['PUT', `/article/${id}`]
      , ['DELETE', `/article/${id}`]
      ] as const)
      expect((await alice.request(method, path, method === 'GET' || method === 'HEAD' || method === 'DELETE' ? undefined : {})).status).toBe(401)

    const live = await withHeader(
      app, 'GET', `/article/${id}`, bearer(second.finish.document.sessionId))
    expect(live.status).toBe(200)
  })

  test('rejects a session that sits exactly on its expiry instant', async () => {
    const { app, db } = await createTestServer({ session: true })
    const alice = await signIn(app, 'alice')

    const originalNow = Date.now
    const boundary = originalNow() + 60_000
    await db.run(
      'UPDATE `key` SET `expires_at` = ? WHERE `id` = ?'
      , [boundary, sessionKeyId(alice.sessionId)])

    Date.now = () => boundary
    try {
      expect((await alice.request('GET', '/article')).status).toBe(401)
    } finally {
      Date.now = originalNow
    }
  })

  test('rejects a session row that has been marked consumed', async () => {
    const { app, db } = await createTestServer({ session: true })
    const alice = await signIn(app, 'alice')

    await db.run(
      'UPDATE `key` SET `consumed_at` = ? WHERE `id` = ?'
      , [Date.now(), sessionKeyId(alice.sessionId)])

    expect((await alice.request('GET', '/article')).status).toBe(401)
  })

  test('stops authorizing a session as soon as it is deleted (logout)', async () => {
    const { app } = await createTestServer({ session: true })
    const alice = await signIn(app, 'alice')
    const other = await login(app, { username: 'alice', password: credentials().password })
    const otherId = other.finish.document.sessionId
    const id = await createArticleAs(alice)

    expect((await deleteKey(app, alice.sessionId)).status).toBe(204)

    expect((await alice.request('GET', `/article/${id}`)).status).toBe(401)
    expect((await alice.request('DELETE', `/article/${id}`)).status).toBe(401)

    const stillValid = await withHeader(app, 'GET', `/article/${id}`, bearer(otherId))
    expect(stillValid.status).toBe(200)
  })

  test('does not require a session for the key routes that create one', async () => {
    const { app } = await createTestServer({ session: true })

    const registered = await register(app, credentials())
    expect(registered.finish.response.status).toBe(200)
    const session = await login(app, { username: 'alice', password: credentials().password })
    expect(session.finish.response.status).toBe(200)
  })

  test('never reflects the session id back in error responses', async () => {
    const { app } = await createTestServer({ session: true })
    const alice = await signIn(app, 'alice')
    const forged = alice.sessionId.replace(/.$/, c => (c === '0' ? '1' : '0'))

    const response = await withHeader(app, 'GET', '/article', bearer(forged))
    expect(response.status).toBe(401)
    const text = await response.text()
    expect(text).not.toContain(forged)
    expect(text).not.toContain(alice.sessionId)
  })
})

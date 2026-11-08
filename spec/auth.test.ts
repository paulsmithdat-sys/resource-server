import { describe, expect, test } from 'bun:test'
import
  { LOGIN_TTL_MS
  , REGISTRATION_TTL_MS
  , SESSION_TTL_MS
  } from '../src/auth/service.ts'
import { uuidToBuffer } from '../src/server/uuid.ts'
import
  { finishLogin
  , finishRegistration
  , getKey
  , login
  , register
  , startLogin
  , startRegistration
  } from './helpers/auth-client.ts'
import { createTestServer } from './helpers/test-server.ts'

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

const postKey =
  async (app: any, body: unknown) =>
    await app.request(
      '/key'
      , { method: 'POST'
        , headers: { 'content-type': 'application/json' }
        , body: JSON.stringify(body)
        })

const patchKey =
  async (app: any, id: string, body: unknown) =>
    await app.request(
      `/key/${id}`
      , { method: 'PATCH'
        , headers: { 'content-type': 'application/json' }
        , body: JSON.stringify(body)
        })

const parsed = async (response: Response) => await response.json() as any

const near =
  (iso: string, ttl: number) => {
    const remaining = Date.parse(iso) - Date.now()
    return remaining > ttl - 10_000 && remaining <= ttl + 1_000
  }

describe('registration', () => {
  test('starts registration without exposing pending state', async () => {
    const { app } = await createTestServer()
    const start = await startRegistration(
      app
      , { username: 'alice'
        , email: 'alice@example.com'
        , password: 'correct horse battery staple'
        , displayName: 'Alice'
        })

    expect(start.response.status).toBe(201)
    expect(start.response.headers.get('location')).toBe(
      `/key/${start.document.id}`)
    expect(start.document.id).toMatch(UUID)
    expect(start.document.type).toBe('opaque_registration')
    expect(near(start.document.expiresAt, REGISTRATION_TTL_MS)).toBe(true)
    expect(start.document.registrationResponse.length).toBeGreaterThan(0)
    expect(start.document.serverPublicKey).toMatchObject(
      { kty: 'OKP', crv: 'Ed25519' })

    const status = await getKey(app, start.document.id)
    expect(status.response.status).toBe(200)
    expect(status.document).toEqual(
      { id: start.document.id
      , type: 'opaque_registration'
      , expiresAt: start.document.expiresAt
      , consumedAt: null
      , userId: null
      })

    const body = JSON.stringify(status.document)
    expect(body).not.toContain('registrationRequest')
    expect(body).not.toContain('registrationRecord')
    expect(body).not.toContain('clientPublicKey')
    expect(body).not.toContain('serverLoginState')
  })

  test('finishes registration and creates an owned user', async () => {
    const { app } = await createTestServer()
    const start = await startRegistration(
      app
      , { username: 'alice'
        , email: 'alice@example.com'
        , password: 'correct horse battery staple'
        , displayName: 'Alice'
        })

    const finish = await finishRegistration(app, start)
    expect(finish.response.status).toBe(200)
    expect(finish.document.id).toBe(start.document.id)
    expect(finish.document.type).toBe('opaque_registration')
    expect(finish.document.userId).toMatch(UUID)
    expect(finish.document.consumedAt).toBeTruthy()

    const user = await app.request(`/user/${finish.document.userId}`)
    expect(user.status).toBe(200)

    const document = await parsed(user)
    expect(document.data.attributes).toMatchObject(
      { username: 'alice'
      , email: 'alice@example.com'
      , display_name: 'Alice'
      , owner: finish.document.userId
      })
    expect(document.data.relationships?.keys).toBeUndefined()

    const status = await getKey(app, start.document.id)
    expect(status.document).toEqual(
      { id: start.document.id
      , type: 'opaque_registration'
      , expiresAt: null
      , consumedAt: finish.document.consumedAt
      , userId: finish.document.userId
      })
  })

  test('rejects duplicate usernames and emails', async () => {
    const { app } = await createTestServer()
    await register(
      app
      , { username: 'alice'
        , email: 'alice@example.com'
        , password: 'correct horse battery staple'
        })

    const duplicateUsername =
      await startRegistration(
        app
        , { username: 'alice'
          , email: 'other@example.com'
          , password: 'another password'
          })
    expect(duplicateUsername.response.status).toBe(409)

    const duplicateEmail =
      await startRegistration(
        app
        , { username: 'other'
          , email: 'alice@example.com'
          , password: 'another password'
          })
    expect(duplicateEmail.response.status).toBe(409)
  })

  test('rejects replayed and expired registration state', async () => {
    const { app } = await createTestServer()
    const start = await startRegistration(
      app
      , { username: 'alice'
        , email: 'alice@example.com'
        , password: 'correct horse battery staple'
        })

    expect((await finishRegistration(app, start)).response.status).toBe(200)

    const replay = await finishRegistration(app, start)
    expect(replay.response.status).toBe(401)
    expect((replay.document as any).errors[0].title).toBe('Unauthorized')
  })

  test('rejects an expired registration state', async () => {
    const { app, db } = await createTestServer()
    const start = await startRegistration(
      app
      , { username: 'alice'
        , email: 'alice@example.com'
        , password: 'correct horse battery staple'
        })

    await db.run(
      'UPDATE `key` SET `expires_at` = ? WHERE `id` = ?'
      , [Date.now() - 1, uuidToBuffer(start.document.id)])

    const finish = await finishRegistration(app, start)
    expect(finish.response.status).toBe(401)

    const status = await getKey(app, start.document.id)
    expect(status.response.status).toBe(404)
  })
})

describe('login and sessions', () => {
  const credentials =
    { username: 'alice'
    , email: 'alice@example.com'
    , password: 'correct horse battery staple'
    , displayName: 'Alice'
    }

  test('starts and finishes login with a fresh keypair', async () => {
    const { app } = await createTestServer()
    const { userId } = await register(app, credentials)

    const start = await startLogin(
      app, { username: credentials.username, password: credentials.password })

    expect(start.response.status).toBe(201)
    expect(start.response.headers.get('location')).toBe(
      `/key/${start.document.id}`)
    expect(start.document.type).toBe('opaque_login_state')
    expect(near(start.document.expiresAt, LOGIN_TTL_MS)).toBe(true)
    expect(start.document.loginResponse.length).toBeGreaterThan(0)

    const pending = await getKey(app, start.document.id)
    expect(pending.document).toEqual(
      { id: start.document.id
      , type: 'opaque_login_state'
      , expiresAt: start.document.expiresAt
      , consumedAt: null
      , userId
      })
    expect(JSON.stringify(pending.document)).not.toContain('serverLoginState')

    const finish = await finishLogin(app, start)
    expect(finish).toBeDefined()
    expect(finish!.response.status).toBe(200)
    expect(finish!.document.type).toBe('session')
    expect(finish!.document.sessionId).toMatch(UUID)
    expect(near(finish!.document.expiresAt, SESSION_TTL_MS)).toBe(true)
    expect(finish!.document.serverPublicKey).toEqual(
      start.document.serverPublicKey)
    expect(JSON.stringify(finish!.document)).not.toContain('sessionKey')
    expect(JSON.stringify(finish!.document)).not.toContain('"d"')

    const session = await getKey(app, finish!.document.sessionId)
    expect(session.document).toEqual(
      { id: finish!.document.sessionId
      , type: 'session'
      , expiresAt: finish!.document.expiresAt
      , consumedAt: null
      , userId
      })

    const consumed = await getKey(app, start.document.id)
    expect(consumed.document.consumedAt).toBeTruthy()
  })

  test('stores the raw client session key in the session row', async () => {
    const { app, db } = await createTestServer()
    await register(app, credentials)

    const result =
      await login(
        app, { username: credentials.username, password: credentials.password })

    const row =
      await db.get(
        'SELECT `material`, `type`, `user_id`, `jwk`, `client_jwk`'
        + ' FROM `key` WHERE `id` = ?'
        , [uuidToBuffer(result.finish.document.sessionId)])

    expect(row?.type).toBe('session')
    expect(row?.material).toBe(result.sessionKey)
    expect(row?.user_id).toBeDefined()
    expect(row?.jwk).toBeTruthy()
    expect(row?.client_jwk).toBeTruthy()
  })

  test('uses a different keypair on every login', async () => {
    const { app } = await createTestServer()
    await register(app, credentials)

    const first =
      await login(
        app, { username: credentials.username, password: credentials.password })
    const second =
      await login(
        app, { username: credentials.username, password: credentials.password })

    expect(first.start.document.serverPublicKey)
      .not.toEqual(second.start.document.serverPublicKey)
    expect(first.start.clientKeyPair.publicJwk)
      .not.toEqual(second.start.clientKeyPair.publicJwk)
    expect(first.finish.sessionKey).not.toBe(second.finish.sessionKey)
  })

  test('rejects replayed login state', async () => {
    const { app } = await createTestServer()
    await register(app, credentials)

    const start = await startLogin(
      app, { username: credentials.username, password: credentials.password })

    const first = await finishLogin(app, start)
    expect(first?.response.status).toBe(200)

    const replay = await finishLogin(app, start)
    expect(replay?.response.status).toBe(401)
  })

  test('rejects invalid login requests', async () => {
    const { app } = await createTestServer()
    await register(app, credentials)

    const start = await startLogin(
      app, { username: credentials.username, password: credentials.password })

    const response =
      await patchKey(
        app, start.document.id, { finishLoginRequest: 'not-a-login-request' })
    expect(response.status).toBe(401)
    expect((await parsed(response)).errors[0].title).toBe('Unauthorized')
  })

  test('gives unknown users the same start response shape but no session', async () => {
    const { app } = await createTestServer()

    const known =
      await startLogin(
        app, { username: 'nobody', password: 'some password' })

    expect(known.response.status).toBe(201)
    expect(Object.keys(known.document).sort()).toEqual(
      [ 'expiresAt', 'id', 'loginResponse', 'serverPublicKey', 'type' ].sort())

    const status = await getKey(app, known.document.id)
    expect(status.response.status).toBe(200)
    expect(status.document.type).toBe('opaque_login_state')
    expect(status.document.userId).toBeNull()

    const response =
      await patchKey(
        app
        , known.document.id
        , { finishLoginRequest: 'not-a-login-request' })
    expect(response.status).toBe(401)
    expect((await parsed(response)).errors[0].title).toBe('Unauthorized')
  })

  test('deletes sessions and purges expired state', async () => {
    const { app, db } = await createTestServer()
    await register(app, credentials)

    const result =
      await login(
        app, { username: credentials.username, password: credentials.password })

    const sessionId = result.finish.document.sessionId
    const removed = await app.request(`/key/${sessionId}`, { method: 'DELETE' })
    expect(removed.status).toBe(204)

    const missing = await getKey(app, sessionId)
    expect(missing.response.status).toBe(404)

    const other = await login(
      app, { username: credentials.username, password: credentials.password })

    await db.run(
      'UPDATE `key` SET `expires_at` = ? WHERE `id` = ?'
      , [Date.now() - 1, uuidToBuffer(other.finish.document.sessionId)])

    const expired = await getKey(app, other.finish.document.sessionId)
    expect(expired.response.status).toBe(404)

    const row =
      await db.get(
        'SELECT 1 AS found FROM `key` WHERE `id` = ?'
        , [uuidToBuffer(other.finish.document.sessionId)])
    expect(row).toBeUndefined()
  })
})

describe('auth route validation', () => {
  test('hides the key resource from the catalog and endpoints', async () => {
    const { app } = await createTestServer()

    const response = await app.request('/key')
    expect(response.status).toBe(404)

    const catalog = await parsed(await app.request('/'))
    const types = catalog.meta.resources.map((x: any) => x.type)
    expect(types).not.toContain('key')

    const user = catalog.meta.resources.find((x: any) => x.type === 'user')
    expect(user.relationships).not.toContain('keys')
    expect(user.attributes).toContain('owner')
  })

  test('rejects malformed key requests', async () => {
    const { app } = await createTestServer()

    expect((await postKey(app, null)).status).toBe(400)
    expect((await postKey(app, {})).status).toBe(400)
    expect((await postKey(app, { type: 'unknown' })).status).toBe(400)

    const missing =
      await postKey(app, { type: 'opaque_registration' })
    expect(missing.status).toBe(400)
    expect((await parsed(missing)).errors[0].source.parameter).toBe('username')

    const badKey =
      await postKey(
        app
        , { type: 'opaque_registration'
          , username: 'alice'
          , email: 'alice@example.com'
          , registrationRequest: 'request'
          , clientPublicKey: { kty: 'RSA' }
          })
    expect(badKey.status).toBe(400)
    expect((await parsed(badKey)).errors[0].source.parameter)
      .toBe('clientPublicKey')

    expect((await getKey(app, 'not-a-uuid')).response.status).toBe(400)
    expect(
      (await app.request('/key/not-a-uuid', { method: 'DELETE' })).status)
      .toBe(400)

    const missingKey = await getKey(app, Bun.randomUUIDv7())
    expect(missingKey.response.status).toBe(404)
  })

  test('requires exactly one finish operation', async () => {
    const { app } = await createTestServer()
    const start = await startRegistration(
      app
      , { username: 'alice'
        , email: 'alice@example.com'
        , password: 'correct horse battery staple'
        })

    expect((await patchKey(app, start.document.id, {})).status).toBe(400)
    expect(
      (await patchKey(
        app
        , start.document.id
        , { registrationRecord: 'record', finishLoginRequest: 'request' }))
        .status)
      .toBe(400)
  })
})

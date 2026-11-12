import { sessionKeyId } from '../src/auth/session-key.ts'
import { describe, expect, test } from 'bun:test'
import { generateKeyPair } from '../src/auth/keys.ts'
import { LOGIN_TTL_MS, SESSION_TTL_MS } from '../src/auth/service/index.ts'
import { UUID_PATTERN, canonicalUuid, uuidToBuffer } from '../src/server/uuid.ts'
import
  { completeClientLogin
  , credentials
  , finishLogin
  , getKey
  , login
  , patchKey
  , postKey
  , register
  , sendFinishLogin
  , startLogin
  , startRegistration
  } from './helpers/auth-client.ts'
import { createTestServer } from './helpers/test-server.ts'

const parsed = async (response: Response) => await response.json() as any

const near =
  (iso: string, ttl: number) => {
    const remaining = Date.parse(iso) - Date.now()
    return remaining > ttl - 10_000 && remaining <= ttl + 1_000
  }

const keyRow =
  async (db: any, id: string): Promise<any> =>
    await db.get(
      'SELECT `type`, `jwk`, `client_jwk`, `material`, `expires_at`,'
      + ' `consumed_at`, `user_id`, `owner` FROM `key` WHERE `id` IN (?, ?)'
      , [uuidToBuffer(id), sessionKeyId(id)])

const loginBody =
  (overrides: Record<string, unknown> = {}) =>
    ({ type: 'opaque_login_state'
    , username: 'alice'
    , startLoginRequest: 'request'
    , clientPublicKey: generateKeyPair().publicJwk
    , ...overrides
    })

const expectBadRequest =
  async (response: Response, parameter: string) => {
    expect(response.status).toBe(400)
    const body = await parsed(response)
    expect(body.errors[0].title).toBe('Bad Request')
    expect(body.errors[0].source?.parameter).toBe(parameter)
  }

describe('login', () => {
  test('starts and finishes login with a fresh keypair', async () => {
    const { app, db } = await createTestServer()
    const { userId } = await register(app, credentials())

    const start =
      await startLogin(
        app
        , { username: 'alice'
          , password: 'correct horse battery staple'
          })

    expect(start.response.status).toBe(201)
    expect(start.response.headers.get('content-type'))
      .toContain('application/json')
    expect(start.response.headers.get('location')).toBe(
      `/key/${start.document.id}`)
    expect(start.document.id).toMatch(UUID_PATTERN)
    expect(start.document.type).toBe('opaque_login_state')
    expect(near(start.document.expiresAt, LOGIN_TTL_MS)).toBe(true)
    expect(start.document.loginResponse.length).toBeGreaterThan(0)
    expect(start.document.serverPublicKey).toMatchObject(
      { kty: 'OKP', crv: 'Ed25519' })

    const pending = await getKey(app, start.document.id)
    expect(pending.response.status).toBe(200)
    expect(pending.document).toEqual(
      { id: start.document.id
      , type: 'opaque_login_state'
      , expiresAt: start.document.expiresAt
      , consumedAt: null
      , userId
      })
    const status = JSON.stringify(pending.document)
    expect(status).not.toContain('serverLoginState')
    expect(status).not.toContain('clientPublicKey')
    expect(status).not.toContain('sessionKey')

    const row = await keyRow(db, start.document.id)
    expect(row?.type).toBe('opaque_login_state')
    expect(JSON.parse(row?.jwk)).toMatchObject(
      { kty: 'OKP', crv: 'Ed25519' })
    expect(JSON.parse(row?.jwk).d).toBeTruthy()
    expect(JSON.parse(row?.client_jwk)).toEqual(start.clientKeyPair.publicJwk)
    expect(typeof row?.material).toBe('string')
    expect(row?.material.length).toBeGreaterThan(0)
    expect(row?.consumed_at).toBeNull()
    expect(canonicalUuid(row?.user_id)).toBe(userId)
    expect(canonicalUuid(row?.owner)).toBe(userId)
    expect(row?.expires_at).toBeGreaterThan(Date.now())

    const finish = await finishLogin(app, start)
    expect(finish).toBeDefined()
    expect(finish!.response.status).toBe(200)
    expect(finish!.response.headers.get('content-type'))
      .toContain('application/json')
    expect(finish!.document.type).toBe('session')
    expect(finish!.document.sessionId).toMatch(UUID_PATTERN)
    expect(near(finish!.document.expiresAt, SESSION_TTL_MS)).toBe(true)
    expect(finish!.document.serverPublicKey).toEqual(
      start.document.serverPublicKey)
    const finishBody = JSON.stringify(finish!.document)
    expect(finishBody).not.toContain('sessionKey')
    expect(finishBody).not.toContain('"d"')

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
    expect(consumed.document.expiresAt).toBe(start.document.expiresAt)

    const consumedRow = await keyRow(db, start.document.id)
    expect(consumedRow?.consumed_at).toBe(
      Date.parse(consumed.document.consumedAt!))
  })

  test('rejects a wrong password without consuming the login state', async () => {
    const { app, db } = await createTestServer()
    await register(app, credentials())

    const start =
      await startLogin(
        app, { username: 'alice', password: 'the wrong password' })

    expect(start.response.status).toBe(201)
    expect(completeClientLogin(start)).toBeUndefined()

    const pending = await getKey(app, start.document.id)
    expect(pending.response.status).toBe(200)
    expect(pending.document.consumedAt).toBeNull()
    expect((await keyRow(db, start.document.id))?.consumed_at).toBeNull()

    const response =
      await patchKey(
        app, start.document.id, { finishLoginRequest: 'not-a-login-request' })
    expect(response.status).toBe(401)
    expect((await parsed(response)).errors[0].title).toBe('Unauthorized')
  })

  test('gives unknown users the same start shape but no session', async () => {
    const { app, db } = await createTestServer()

    const start =
      await startLogin(app, { username: 'nobody', password: 'some password' })

    expect(start.response.status).toBe(201)
    expect(Object.keys(start.document).sort()).toEqual(
      [ 'expiresAt', 'id', 'loginResponse', 'serverPublicKey', 'type' ].sort())

    const status = await getKey(app, start.document.id)
    expect(status.response.status).toBe(200)
    expect(status.document.type).toBe('opaque_login_state')
    expect(status.document.consumedAt).toBeNull()
    expect(status.document.userId).toBeNull()

    const row = await keyRow(db, start.document.id)
    expect(row?.user_id).toBeNull()
    expect(row?.owner).toBeNull()

    expect(completeClientLogin(start)).toBeUndefined()

    const response =
      await patchKey(
        app, start.document.id, { finishLoginRequest: 'not-a-login-request' })
    expect(response.status).toBe(401)
    expect((await parsed(response)).errors[0].title).toBe('Unauthorized')
  })

  test('rejects login for a generic user without a registration record', async () => {
    const { app, db } = await createTestServer()

    const userId = Bun.randomUUIDv7()
    await db.run(
      'INSERT INTO `user` (`id`, `username`) VALUES (?, ?)'
      , [uuidToBuffer(userId), 'legacy'])

    const start =
      await startLogin(
        app, { username: 'legacy', password: 'some password' })

    expect(start.response.status).toBe(201)
    expect(completeClientLogin(start)).toBeUndefined()

    const status = await getKey(app, start.document.id)
    expect(status.document.userId).toBeNull()
    expect((await keyRow(db, start.document.id))?.user_id).toBeNull()

    const response =
      await patchKey(
        app, start.document.id, { finishLoginRequest: 'not-a-login-request' })
    expect(response.status).toBe(401)

    const user = await app.request(`/user/${userId}`)
    expect(user.status).toBe(200)
  })

  test('burns the login state after an invalid finish', async () => {
    const { app } = await createTestServer()
    await register(app, credentials())

    const start =
      await startLogin(
        app
        , { username: 'alice'
          , password: 'correct horse battery staple'
          })

    const loginResult = completeClientLogin(start)
    expect(loginResult).toBeDefined()

    const invalid =
      await sendFinishLogin(app, start.document.id, 'not-a-login-request')
    expect(invalid.response.status).toBe(401)

    const pending = await getKey(app, start.document.id)
    expect(pending.document.consumedAt).not.toBeNull()

    const valid =
      await sendFinishLogin(
        app, start.document.id, loginResult!.finishLoginRequest)
    expect(valid.response.status).toBe(401)
  })

  test('rejects replayed login state', async () => {
    const { app } = await createTestServer()
    await register(app, credentials())

    const start =
      await startLogin(
        app
        , { username: 'alice'
          , password: 'correct horse battery staple'
          })

    const first = await finishLogin(app, start)
    expect(first?.response.status).toBe(200)

    const replay = await finishLogin(app, start)
    expect(replay?.response.status).toBe(401)
    expect((replay!.document as any).errors[0].title).toBe('Unauthorized')
  })

  test('rejects an expired login state and purges it', async () => {
    const { app, db } = await createTestServer()
    await register(app, credentials())

    const start =
      await startLogin(
        app
        , { username: 'alice'
          , password: 'correct horse battery staple'
          })

    await db.run(
      'UPDATE `key` SET `expires_at` = ? WHERE `id` = ?'
      , [Date.now() - 1, uuidToBuffer(start.document.id)])

    const finish = await finishLogin(app, start)
    expect(finish?.response.status).toBe(401)

    const status = await getKey(app, start.document.id)
    expect(status.response.status).toBe(404)
    expect(await keyRow(db, start.document.id)).toBeUndefined()
  })

  test('rejects finishing at exactly the TTL boundary', async () => {
    const { app, db } = await createTestServer()
    await register(app, credentials())

    const start =
      await startLogin(
        app
        , { username: 'alice'
          , password: 'correct horse battery staple'
          })

    await db.run(
      'UPDATE `key` SET `expires_at` = ? WHERE `id` = ?'
      , [Date.now(), uuidToBuffer(start.document.id)])

    expect((await finishLogin(app, start))?.response.status).toBe(401)
  })

  test('rejects finishing a login on a registration row', async () => {
    const { app } = await createTestServer()
    const registration = await startRegistration(app, credentials())

    const response =
      await patchKey(
        app, registration.document.id, { finishLoginRequest: 'request' })
    expect(response.status).toBe(401)

    const status = await getKey(app, registration.document.id)
    expect(status.document.type).toBe('opaque_registration')
    expect(status.document.consumedAt).toBeNull()
  })

  test('validates login fields before starting OPAQUE', async () => {
    const { app } = await createTestServer()

    await expectBadRequest(
      await postKey(app, loginBody({ username: undefined }))
      , 'username')
    await expectBadRequest(
      await postKey(app, loginBody({ username: '' }))
      , 'username')
    await expectBadRequest(
      await postKey(app, loginBody({ username: 'a'.repeat(101) }))
      , 'username')
    await expectBadRequest(
      await postKey(app, loginBody({ startLoginRequest: undefined }))
      , 'startLoginRequest')
    await expectBadRequest(
      await postKey(app, loginBody({ startLoginRequest: '' }))
      , 'startLoginRequest')
    await expectBadRequest(
      await postKey(app, loginBody({ clientPublicKey: { kty: 'RSA' } }))
      , 'clientPublicKey')
    await expectBadRequest(
      await postKey(app, loginBody({ clientPublicKey: generateKeyPair().privateJwk }))
      , 'clientPublicKey')
  })

  test('uses a different keypair and session key on every login', async () => {
    const { app } = await createTestServer()
    await register(app, credentials())

    const first =
      await login(
        app
        , { username: 'alice'
          , password: 'correct horse battery staple'
          })
    const second =
      await login(
        app
        , { username: 'alice'
          , password: 'correct horse battery staple'
          })

    expect(first.start.document.serverPublicKey)
      .not.toEqual(second.start.document.serverPublicKey)
    expect(first.start.clientKeyPair.publicJwk)
      .not.toEqual(second.start.clientKeyPair.publicJwk)
    expect(first.finish.sessionKey).not.toBe(second.finish.sessionKey)
    expect(first.finish.document.sessionId)
      .not.toBe(second.finish.document.sessionId)
  })

  test('links every issued session to the same user', async () => {
    const { app, db } = await createTestServer()
    const { userId } = await register(app, credentials())

    const first =
      await login(
        app
        , { username: 'alice'
          , password: 'correct horse battery staple'
          })
    const second =
      await login(
        app
        , { username: 'alice'
          , password: 'correct horse battery staple'
          })

    for (const result of [first, second]) {
      const session = await getKey(app, result.finish.document.sessionId)
      expect(session.response.status).toBe(200)
      expect(session.document.userId).toBe(userId)

      const row = await keyRow(db, result.finish.document.sessionId)
      expect(row?.type).toBe('session')
      expect(canonicalUuid(row?.user_id)).toBe(userId)
      expect(canonicalUuid(row?.owner)).toBe(userId)
    }
  })
})

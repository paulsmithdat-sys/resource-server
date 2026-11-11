import { describe, expect, test } from 'bun:test'
import { generateKeyPair } from '../src/auth/keys.ts'
import { REGISTRATION_TTL_MS } from '../src/auth/service.ts'
import { UUID_PATTERN, canonicalUuid, uuidToBuffer } from '../src/server/uuid.ts'
import
  { completeClientRegistration
  , credentials
  , deleteKey
  , finishRegistration
  , getKey
  , patchKey
  , postKey
  , register
  , sendFinishRegistration
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
      + ' `consumed_at`, `user_id`, `owner` FROM `key` WHERE `id` = ?'
      , [uuidToBuffer(id)])

const userCount =
  async (db: any): Promise<number> => {
    const row = await db.get('SELECT count(*) AS count FROM `user`') as any
    return Number(row?.count)
  }

const registrationBody =
  (overrides: Record<string, unknown> = {}) =>
    ({ type: 'opaque_registration'
    , username: 'alice'
    , registrationRequest: 'request'
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

describe('registration', () => {
  test('starts registration without requiring or storing email', async () => {
    const { app, db } = await createTestServer()
    const start = await startRegistration(
      app
      , { username: 'alice'
        , password: 'correct horse battery staple'
        , displayName: 'Alice'
        })

    expect(start.response.status).toBe(201)
    expect(start.response.headers.get('content-type'))
      .toContain('application/json')
    expect(start.response.headers.get('location')).toBe(
      `/key/${start.document.id}`)
    expect(start.document.id).toMatch(UUID_PATTERN)
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
    expect(body).not.toContain('"email"')

    const row = await keyRow(db, start.document.id)
    const pending = JSON.parse(row?.material) as any
    expect(row?.type).toBe('opaque_registration')
    expect(JSON.parse(row?.jwk)).toEqual(start.clientKeyPair.publicJwk)
    expect(row?.client_jwk).toBeNull()
    expect(row?.consumed_at).toBeNull()
    expect(row?.user_id).toBeNull()
    expect(row?.owner).toBeNull()
    expect(row?.expires_at).toBeGreaterThan(Date.now())
    expect(pending).toMatchObject(
      { username: 'alice'
      , displayName: 'Alice'
      })
    expect(pending.email).toBeUndefined()
    expect(pending.userId).toMatch(UUID_PATTERN)
  })

  test('finishes registration and creates an owned user without email', async () => {
    const { app, db } = await createTestServer()
    const start = await startRegistration(
      app
      , { username: 'alice'
        , password: 'correct horse battery staple'
        , displayName: 'Alice'
        })

    const registrationRecord = completeClientRegistration(start)
    const finish =
      await sendFinishRegistration(
        app, start.document.id, registrationRecord)

    expect(finish.response.status).toBe(200)
    expect(finish.document.id).toBe(start.document.id)
    expect(finish.document.type).toBe('opaque_registration')
    expect(finish.document.userId).toMatch(UUID_PATTERN)
    expect(finish.document.consumedAt).toBeTruthy()

    const user = await app.request(`/user/${finish.document.userId}`)
    expect(user.status).toBe(200)

    const document = await parsed(user)
    expect(document.data.attributes).toMatchObject(
      { username: 'alice'
      , display_name: 'Alice'
      , owner: finish.document.userId
      , email: null
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

    const row = await keyRow(db, start.document.id)
    expect(row?.type).toBe('opaque_registration')
    expect(JSON.parse(row?.jwk)).toEqual(start.clientKeyPair.publicJwk)
    expect(row?.material).toBe(registrationRecord)
    expect(row?.expires_at).toBeNull()
    expect(row?.consumed_at).toBe(Date.parse(finish.document.consumedAt))
    expect(canonicalUuid(row?.user_id)).toBe(finish.document.userId)
    expect(canonicalUuid(row?.owner)).toBe(finish.document.userId)
  })

  test('treats an omitted or empty display name as null', async () => {
    const { app } = await createTestServer()

    const omitted =
      await register(app, credentials({ displayName: undefined }))
    const omittedUser =
      await parsed(await app.request(`/user/${omitted.userId}`))
    expect(omittedUser.data.attributes.display_name).toBeNull()

    const empty =
      await register(
        app
        , credentials({ username: 'bob', displayName: '' }))
    const emptyUser =
      await parsed(await app.request(`/user/${empty.userId}`))
    expect(emptyUser.data.attributes.display_name).toBeNull()
  })

  test('validates registration fields without requiring email', async () => {
    const { app } = await createTestServer()

    await expectBadRequest(
      await postKey(app, registrationBody({ username: undefined }))
      , 'username')
    await expectBadRequest(
      await postKey(app, registrationBody({ username: '' }))
      , 'username')
    await expectBadRequest(
      await postKey(app, registrationBody({ username: 'a'.repeat(101) }))
      , 'username')
    await expectBadRequest(
      await postKey(app, registrationBody({ displayName: 'a'.repeat(101) }))
      , 'displayName')
    await expectBadRequest(
      await postKey(app, registrationBody({ registrationRequest: undefined }))
      , 'registrationRequest')
    await expectBadRequest(
      await postKey(app, registrationBody({ registrationRequest: '' }))
      , 'registrationRequest')
    await expectBadRequest(
      await postKey(app, registrationBody({ clientPublicKey: undefined }))
      , 'clientPublicKey')
    await expectBadRequest(
      await postKey(app, registrationBody({ clientPublicKey: { kty: 'RSA' } }))
      , 'clientPublicKey')
    await expectBadRequest(
      await postKey(
        app
        , registrationBody({ clientPublicKey: generateKeyPair().privateJwk }))
      , 'clientPublicKey')

    // Email is not part of registration; unknown fields are rejected.
    const withEmail =
      await postKey(app, registrationBody({ email: 'alice@example.com' }))
    expect(withEmail.status).toBe(400)

    // Omitting email is fine.
    const ok = await startRegistration(app, credentials({ username: 'carol' }))
    expect(ok.response.status).toBe(201)
  })

  test('rejects duplicate usernames at start with a username-only conflict', async () => {
    const { app } = await createTestServer()
    await register(app, credentials())

    const duplicate =
      await startRegistration(app, credentials({ username: 'alice' }))
    expect(duplicate.response.status).toBe(409)
    const body = duplicate.document as any
    expect(body.errors[0].title).toBe('Conflict')
    expect(body.errors[0].detail).toBe('A user with that username already exists')
    expect(JSON.stringify(body)).not.toContain('email')
  })

  test('rejects duplicates discovered when finishing a second registration', async () => {
    const { app, db } = await createTestServer()

    const first = await startRegistration(app, credentials())
    const second = await startRegistration(app, credentials())

    expect(first.response.status).toBe(201)
    expect(second.response.status).toBe(201)

    expect((await finishRegistration(app, first)).response.status).toBe(200)

    const conflict = await finishRegistration(app, second)
    expect(conflict.response.status).toBe(409)
    expect((conflict.document as any).errors[0].title).toBe('Conflict')
    expect((conflict.document as any).errors[0].detail)
      .toBe('A user with that username already exists')
    expect(await userCount(db)).toBe(1)

    const row = await keyRow(db, second.document.id)
    expect(row?.consumed_at).toBeNull()
  })

  test('rejects replayed and expired registration state', async () => {
    const { app } = await createTestServer()
    const start = await startRegistration(app, credentials())

    expect((await finishRegistration(app, start)).response.status).toBe(200)

    const replay = await finishRegistration(app, start)
    expect(replay.response.status).toBe(401)
    expect((replay.document as any).errors[0].title).toBe('Unauthorized')
  })

  test('rejects an expired registration state and purges it', async () => {
    const { app, db } = await createTestServer()
    const start = await startRegistration(app, credentials())

    await db.run(
      'UPDATE `key` SET `expires_at` = ? WHERE `id` = ?'
      , [Date.now() - 1, uuidToBuffer(start.document.id)])

    const finish = await finishRegistration(app, start)
    expect(finish.response.status).toBe(401)

    const status = await getKey(app, start.document.id)
    expect(status.response.status).toBe(404)
    expect(await keyRow(db, start.document.id)).toBeUndefined()
  })

  test('finishes at exactly the TTL boundary only while unexpired', async () => {
    const { app, db } = await createTestServer()
    const start = await startRegistration(app, credentials())

    await db.run(
      'UPDATE `key` SET `expires_at` = ? WHERE `id` = ?'
      , [Date.now(), uuidToBuffer(start.document.id)])

    expect((await finishRegistration(app, start)).response.status).toBe(401)
  })

  test('rejects finishing a registration on a login or session row', async () => {
    const { app } = await createTestServer()
    await register(app, credentials())

    const login =
      await startLogin(
        app
        , { username: 'alice'
          , password: 'correct horse battery staple'
          })
    const loginFinish = await patchKey(
      app, login.document.id, { registrationRecord: 'record' })
    expect(loginFinish.status).toBe(401)

    const registration =
      await startRegistration(app, credentials({ username: 'bob' }))
    const registrationFinish = await patchKey(
      app, registration.document.id, { finishLoginRequest: 'request' })
    expect(registrationFinish.status).toBe(401)
  })

  test('deletes a pending registration and blocks its finish', async () => {
    const { app } = await createTestServer()
    const start = await startRegistration(app, credentials())

    expect((await deleteKey(app, start.document.id)).status).toBe(204)
    expect((await finishRegistration(app, start)).response.status).toBe(401)
    expect((await getKey(app, start.document.id)).response.status).toBe(404)
  })

  test('purges expired state when a new registration starts', async () => {
    const { app, db } = await createTestServer()

    const expired = await startRegistration(app, credentials())
    await db.run(
      'UPDATE `key` SET `expires_at` = ? WHERE `id` = ?'
      , [Date.now() - 1, uuidToBuffer(expired.document.id)])

    const fresh =
      await startRegistration(app, credentials({ username: 'bob' }))
    expect(fresh.response.status).toBe(201)
    expect(await keyRow(db, expired.document.id)).toBeUndefined()
  })
})

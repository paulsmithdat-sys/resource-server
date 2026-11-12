import { sessionKeyId } from '../src/auth/session-key.ts'
import { describe, expect, test } from 'bun:test'
import { SESSION_TTL_MS } from '../src/auth/service/index.ts'
import { canonicalUuid, uuidToBuffer } from '../src/server/uuid.ts'
import
  { credentials
  , deleteKey
  , getKey
  , login
  , register
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

const keyCount =
  async (db: any): Promise<number> => {
    const row = await db.get('SELECT count(*) AS count FROM `key`') as any
    return Number(row?.count)
  }

describe('sessions', () => {
  test('stores the raw client session key with both JWKs and the owner', async () => {
    const { app, db } = await createTestServer()
    const { userId } = await register(app, credentials())

    const result =
      await login(
        app
        , { username: 'alice'
          , password: 'correct horse battery staple'
          })

    const sessionId = result.finish.document.sessionId
    const row = await keyRow(db, sessionId)

    expect(row?.type).toBe('session')
    expect(row?.material).toBe(result.sessionKey)
    expect(row?.material.length).toBeGreaterThan(0)
    expect(row?.consumed_at).toBeNull()
    expect(near(new Date(row?.expires_at).toISOString(), SESSION_TTL_MS))
      .toBe(true)
    expect(canonicalUuid(row?.user_id)).toBe(userId)
    expect(canonicalUuid(row?.owner)).toBe(userId)

    const serverJwk = JSON.parse(row?.jwk)
    expect(serverJwk).toEqual({
      kty: 'OKP', crv: 'Ed25519', x: expect.any(String), d: expect.any(String),
    })
    expect(JSON.parse(row?.client_jwk)).toEqual(result.start.clientKeyPair.publicJwk)
    expect(result.finish.document.serverPublicKey).toEqual(
      { kty: 'OKP', crv: 'Ed25519', x: serverJwk.x })
  })

  test('never exposes session material or private keys through status', async () => {
    const { app } = await createTestServer()
    await register(app, credentials())

    const result =
      await login(
        app
        , { username: 'alice'
          , password: 'correct horse battery staple'
          })

    const sessionId = result.finish.document.sessionId
    const status = await getKey(app, sessionId)

    expect(status.response.status).toBe(200)
    expect(status.document).toEqual(
      { id: sessionId
      , type: 'session'
      , expiresAt: result.finish.document.expiresAt
      , consumedAt: null
      , userId: expect.any(String)
      })

    const body = JSON.stringify(status.document)
    expect(body).not.toContain(result.sessionKey)
    expect(body).not.toContain('sessionKey')
    expect(body).not.toContain('material')
    expect(body).not.toContain('jwk')
    expect(body).not.toContain('"d"')
  })

  test('expires sessions after the 24 hour TTL and purges them', async () => {
    const { app, db } = await createTestServer()
    await register(app, credentials())

    const result =
      await login(
        app
        , { username: 'alice'
          , password: 'correct horse battery staple'
          })

    const sessionId = result.finish.document.sessionId

    await db.run(
      'UPDATE `key` SET `expires_at` = ? WHERE `id` = ?'
      , [Date.now() - 1, sessionKeyId(sessionId)])

    const expired = await getKey(app, sessionId)
    expect(expired.response.status).toBe(404)
    expect(await keyRow(db, sessionId)).toBeUndefined()
  })

  test('deletes one session without affecting other sessions or registration', async () => {
    const { app, db } = await createTestServer()
    const { start, userId } = await register(app, credentials())

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

    expect((await deleteKey(app, first.finish.document.sessionId)).status)
      .toBe(204)
    expect((await getKey(app, first.finish.document.sessionId)).response.status)
      .toBe(404)

    const surviving = await getKey(app, second.finish.document.sessionId)
    expect(surviving.response.status).toBe(200)
    expect(surviving.document.userId).toBe(userId)

    const registration = await getKey(app, start.document.id)
    expect(registration.response.status).toBe(200)
    expect(registration.document.consumedAt).toBeTruthy()
    expect(registration.document.userId).toBe(userId)
    expect((await keyRow(db, start.document.id))?.material).toBeTruthy()
  })

  test('rejects deleting missing or malformed session ids', async () => {
    const { app } = await createTestServer()

    expect((await deleteKey(app, Bun.randomUUIDv7())).status).toBe(404)
    expect((await deleteKey(app, 'not-a-uuid')).status).toBe(400)

    const missing = await getKey(app, Bun.randomUUIDv7())
    expect(missing.response.status).toBe(404)
    expect((missing.document as any).errors[0].title).toBe('Not Found')
  })

  test('purges all expired keys while keeping live sessions', async () => {
    const { app, db } = await createTestServer()
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
    const live =
      await login(
        app
        , { username: 'alice'
          , password: 'correct horse battery staple'
          })

    await db.run(
      'UPDATE `key` SET `expires_at` = ? WHERE `id` IN (?, ?)'
      , [ Date.now() - 1
        , sessionKeyId(first.finish.document.sessionId)
        , sessionKeyId(second.finish.document.sessionId)
        ])

    const before = await keyCount(db)
    const status = await getKey(app, live.finish.document.sessionId)
    expect(status.response.status).toBe(200)

    expect(await keyRow(db, first.finish.document.sessionId)).toBeUndefined()
    expect(await keyRow(db, second.finish.document.sessionId)).toBeUndefined()
    expect(await keyRow(db, live.finish.document.sessionId)).toBeDefined()
    expect(await keyCount(db)).toBe(before - 2)
  })

  test('keeps completed registration state usable after sessions change', async () => {
    const { app, db } = await createTestServer()
    const { start, userId } = await register(app, credentials())
    const original = (await keyRow(db, start.document.id))?.material

    const result =
      await login(
        app
        , { username: 'alice'
          , password: 'correct horse battery staple'
          })

    expect((await deleteKey(app, result.finish.document.sessionId)).status)
      .toBe(204)

    const row = await keyRow(db, start.document.id)
    expect(row?.type).toBe('opaque_registration')
    expect(row?.material).toBe(original)
    expect(row?.expires_at).toBeNull()
    expect(row?.consumed_at).toBeTruthy()
    expect(canonicalUuid(row?.user_id)).toBe(userId)

    const status = await getKey(app, start.document.id)
    expect(status.document.expiresAt).toBeNull()
    expect(status.document.userId).toBe(userId)
  })
})

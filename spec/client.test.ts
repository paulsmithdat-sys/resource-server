import { describe, expect, test } from 'bun:test'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { Hono } from 'hono'
import
  { createResourceServerClient
  , memoryStorage
  , ResourceServerError
  , SESSION_STORAGE_KEY
  , type FetchLike
  , type SessionStorage
  } from '../src/client/index.ts'
import { createHttp } from '../src/client/http.ts'
import { createTestServer } from './helpers/test-server.ts'

const BASE_URL = 'http://localhost'

const fetchFor =
  (app: Hono): FetchLike =>
    /** Route the client's fetch calls into an in-process Hono app. */
    async (input, init) => {
      if (typeof input === 'string') return await app.request(input, init)
      if (input instanceof URL) return await app.request(input.toString(), init)
      return await app.request(input)
    }

const connect =
  async (options: { autoSign?: boolean, storage?: SessionStorage | null } = {}) => {
    const server = await createTestServer({ session: true })
    const storage = options.storage ?? memoryStorage()
    const client =
      createResourceServerClient(
        { baseUrl: BASE_URL
        , fetch: fetchFor(server.app)
        , storage
        , autoSign: options.autoSign
        })
    return { ...server, client, storage }
  }

const alice =
  { username: 'alice'
  , password: 'correct horse battery staple'
  , displayName: 'Alice'
  }

const payment = (amount = 100) =>
  ({ data: { type: 'payment', attributes: { amount, currency: 'NZD' } } })

describe('resource server client', () => {
  test('keeps a path prefix from baseUrl', () => {
    const http = createHttp({ baseUrl: 'https://example.com/api/' })

    expect(http.resolve('/article').toString())
      .toBe('https://example.com/api/article')
    expect(http.resolve('article').toString())
      .toBe('https://example.com/api/article')
  })

  test('register signs in by default and exposes the session', async () => {
    const { client } = await connect()

    const { userId, session } = await client.register(alice)

    expect(session).not.toBeNull()
    expect(session!.userId).toBe(userId)
    expect(client.isSignedIn).toBe(true)
    expect(client.session?.sessionId).toBe(session!.sessionId)
    expect(client.session?.secretKey).toMatch(/^[A-Za-z0-9_-]+$/)
  })

  test('register can skip the automatic login', async () => {
    const { client } = await connect()

    const result = await client.register(alice, { signIn: false })

    expect(result.userId).toMatch(/^[0-9a-f-]{36}$/)
    expect(result.session).toBeNull()
    expect(client.isSignedIn).toBe(false)
    expect(client.session).toBeNull()
  })

  test('registering the same username twice fails with 409', async () => {
    const { client } = await connect()

    await client.register(alice, { signIn: false })

    const error =
      await client
        .register(alice, { signIn: false })
        .catch(value => value)

    expect(error).toBeInstanceOf(ResourceServerError)
    expect((error as ResourceServerError).status).toBe(409)
  })

  test('wrong passwords and unknown users fail with 401', async () => {
    const { client } = await connect()
    await client.register(alice, { signIn: false })

    for (const input of
      [ { username: alice.username, password: 'not the password' }
      , { username: 'nobody', password: alice.password }
      ]) {
      const error = await client.login(input).catch(value => value)
      expect(error).toBeInstanceOf(ResourceServerError)
      expect((error as ResourceServerError).status).toBe(401)
    }

    expect(client.isSignedIn).toBe(false)
  })

  test('logout clears the local session and revokes the token', async () => {
    const { client } = await connect()
    const { session } = await client.register(alice)
    const token = session!.sessionId

    await client.logout()

    expect(client.isSignedIn).toBe(false)
    expect(client.session).toBeNull()

    const response =
      await client.request(
        '/article', { headers: { authorization: `Bearer ${token}` } })
    expect(response.status).toBe(401)

    // Logging out twice is harmless.
    await client.logout()
  })

  test('a second client restores the persisted session', async () => {
    const { storage } = await connect()
    const first = await connect({ storage })
    const { session } = await first.client.register(alice)

    const second =
      createResourceServerClient(
        { baseUrl: BASE_URL
        , fetch: fetchFor(first.app)
        , storage
        })

    const restored = second.restore()
    expect(restored?.sessionId).toBe(session!.sessionId)
    expect(restored?.secretKey).toBe(session!.secretKey)
    expect(second.isSignedIn).toBe(true)
  })

  test('expired or malformed stored sessions are discarded', async () => {
    const storage = memoryStorage()

    for (const value of
      [ JSON.stringify(
          { sessionId: 'id'
          , userId: 'user'
          , expiresAt: new Date(Date.now() - 1_000).toISOString()
          , clientPublicKey: { kty: 'OKP' }
          , serverPublicKey: { kty: 'OKP' }
          , secretKey: 'key'
          })
      , 'not json'
      ]) {
      storage.setItem(SESSION_STORAGE_KEY, value)

      const { client } = await connect({ storage })

      expect(client.restore()).toBeNull()
      expect(storage.getItem(SESSION_STORAGE_KEY)).toBeNull()
    }
  })

  test('signed writes work and unsigned writes are rejected', async () => {
    const { client } = await connect()
    await client.register(alice)

    const unsigned = await client.post('/payment', payment()).catch(value => value)
    expect(unsigned).toBeInstanceOf(ResourceServerError)
    expect((unsigned as ResourceServerError).status).toBe(401)

    const created =
      await client.post<{ data: { id: string } }>(
        '/payment', payment(), { signed: true })
    expect(created.data.id).toMatch(/^[0-9a-f-]{36}$/)

    // Reads are not in the schema's signed list.
    const read =
      await client.get<{ data: { attributes: { amount: number } } }>(
        `/payment/${created.data.id}`)
    expect(read.data.attributes.amount).toBe(100)
  })

  test('autoSign signs every request while a session exists', async () => {
    const { client } = await connect({ autoSign: true })
    await client.register(alice)

    const created =
      await client.post<{ data: { id: string } }>('/payment', payment(250))
    expect(created.data.id).toBeString()
  })

  test('signed requests need a session', async () => {
    const { client } = await connect()

    const error =
      await client.post('/payment', payment(), { signed: true })
        .catch(value => value)

    expect(error).toBeInstanceOf(ResourceServerError)
    expect((error as ResourceServerError).status).toBe(401)
  })

  test('request() returns raw responses instead of throwing', async () => {
    const { client } = await connect()

    const response = await client.get('/article').catch(value => value)

    expect(response).toBeInstanceOf(ResourceServerError)
    expect((response as ResourceServerError).status).toBe(401)

    const raw = await client.request('/article')
    expect(raw.status).toBe(401)
  })

  test('the client bundle does not depend on Bun or the server modules', async () => {
    const directory = join(import.meta.dir, '../src/client')
    const files =
      [ 'auth.ts', 'crypto.ts', 'errors.ts', 'http.ts', 'index.ts', 'session.ts' ]

    for (const file of files) {
      const source = await readFile(join(directory, file), 'utf8')
      const problems =
        [ /\bBun\./, /\bBuffer\./, /new Buffer\b/, /from ['"]node:/
        , /from ['"][^'"]*\/server\//
        ].filter(pattern => pattern.test(source))
      expect({ file, problems }).toEqual({ file, problems: [] })
    }
  })
})

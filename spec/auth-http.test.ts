import { describe, expect, test } from 'bun:test'
import
  { credentials
  , deleteKey
  , getKey
  , headKey
  , optionsKey
  , patchKey
  , postKey
  , register
  , startRegistration
  } from './helpers/auth-client.ts'
import { createTestServer } from './helpers/test-server.ts'

const JSON_API = 'application/vnd.api+json'

const parsed = async (response: Response) => await response.json() as any

const viewNames =
  async (db: any): Promise<string[]> => {
    const rows =
      await db.all(
        "SELECT name FROM sqlite_master WHERE type = 'view' ORDER BY name")
    return rows.map((row: any) => String(row.name))
  }

const expectBadRequest =
  async (response: Response, parameter?: string) => {
    expect(response.status).toBe(400)
    expect(response.headers.get('content-type')).toContain(JSON_API)
    const body = await parsed(response)
    expect(body.errors[0].title).toBe('Bad Request')
    if (parameter)
      expect(body.errors[0].source?.parameter).toBe(parameter)
  }

describe('auth http surface', () => {
  test('serves HEAD and OPTIONS for key resources', async () => {
    const { app } = await createTestServer()
    const start = await startRegistration(app, credentials())

    const head = await headKey(app, start.document.id)
    expect(head.status).toBe(200)
    expect(head.headers.get('content-type')).toContain('application/json')
    expect(await head.text()).toBe('')

    const collection = await optionsKey(app)
    expect(collection.status).toBe(204)
    expect(collection.headers.get('allow')).toBe('POST, OPTIONS')

    const item = await optionsKey(app, start.document.id)
    expect(item.status).toBe(204)
    expect(item.headers.get('allow'))
      .toBe('GET, HEAD, PATCH, DELETE, OPTIONS')
  })

  test('uses JSON for success and JSON:API for errors', async () => {
    const { app } = await createTestServer()

    const missing = await postKey(app, { type: 'opaque_registration' })
    await expectBadRequest(missing, 'username')

    const unknown = await postKey(app, { type: 'unknown' })
    expect(unknown.status).toBe(400)
    expect(unknown.headers.get('content-type')).toContain(JSON_API)

    const start = await startRegistration(app, credentials())
    expect(start.response.status).toBe(201)
    expect(start.response.headers.get('content-type'))
      .toContain('application/json')
    expect(start.response.headers.get('content-type'))
      .not.toContain(JSON_API)

    const notFound = await getKey(app, Bun.randomUUIDv7())
    expect(notFound.response.status).toBe(404)
    expect(notFound.response.headers.get('content-type')).toContain(JSON_API)
  })

  test('rejects malformed bodies and ids', async () => {
    const { app } = await createTestServer()

    const broken =
      await app.request(
        '/key'
        , { method: 'POST'
          , headers: { 'content-type': 'application/json' }
          , body: '{'
          })
    await expectBadRequest(broken)

    for (const body of [null, [], 'text', 42]) {
      await expectBadRequest(await postKey(app, body))
    }

    await expectBadRequest(await postKey(app, {}), 'type')
    await expectBadRequest(await postKey(app, { type: 42 }), 'type')
    await expectBadRequest(await postKey(app, { type: 'unknown' }), 'type')

    await expectBadRequest(
      await postKey(app, { type: 'opaque_registration' }), 'username')
    await expectBadRequest(
      await postKey(app, { type: 'opaque_login_state' }), 'username')

    expect((await getKey(app, 'not-a-uuid')).response.status).toBe(400)
    expect((await patchKey(app, 'not-a-uuid', { registrationRecord: 'x' }))
      .status).toBe(400)
    expect((await deleteKey(app, 'not-a-uuid')).status).toBe(400)
    expect((await headKey(app, 'not-a-uuid')).status).toBe(400)
  })

  test('requires exactly one finish operation', async () => {
    const { app } = await createTestServer()
    const start = await startRegistration(app, credentials())

    await expectBadRequest(await patchKey(app, start.document.id, {}))
    await expectBadRequest(await patchKey(app, start.document.id, null))
    await expectBadRequest(
      await patchKey(
        app
        , start.document.id
        , { registrationRecord: 'record', finishLoginRequest: 'request' }))

    const status = await getKey(app, start.document.id)
    expect(status.document.consumedAt).toBeNull()
  })

  test('hides the key resource from the catalog and generic routes', async () => {
    const { app } = await createTestServer()

    expect((await app.request('/key')).status).toBe(404)
    expect((await app.request('/key/not-a-uuid')).status).toBe(400)
    expect((await app.request('/key', { method: 'PUT' })).status).toBe(404)
    expect(
      (await app.request(`/key/${Bun.randomUUIDv7()}`, { method: 'PUT' }))
        .status)
      .toBe(404)

    const catalog = await parsed(await app.request('/'))
    const types = catalog.meta.resources.map((x: any) => x.type)
    expect(types).not.toContain('key')

    const user = catalog.meta.resources.find((x: any) => x.type === 'user')
    expect(user.attributes).toContain('owner')
    expect(user.attributes).not.toContain('material')
    expect(user.relationships).not.toContain('keys')
    expect(user.relationships).not.toContain('key')
  })

  test('does not generate a key view', async () => {
    const { db } = await createTestServer()
    const views = await viewNames(db)

    expect(views).not.toContain('key_view')
    expect(views).toContain('user_view')
  })

  test('omits auth routes when auth is disabled', async () => {
    const { app } = await createTestServer({ auth: false })

    expect((await postKey(app, { type: 'opaque_registration' })).status)
      .toBe(404)
    expect((await getKey(app, Bun.randomUUIDv7())).response.status).toBe(404)
    expect((await getKey(app, 'not-a-uuid')).response.status).toBe(404)
    expect((await deleteKey(app, Bun.randomUUIDv7())).status).toBe(404)

    const options = await app.request('/key', { method: 'OPTIONS' })
    expect(options.status).toBe(204)
    expect(options.headers.get('allow')).toBe('GET, HEAD, POST, OPTIONS')

    const catalog = await parsed(await app.request('/'))
    const types = catalog.meta.resources.map((x: any) => x.type)
    expect(types).not.toContain('key')
  })

  test('returns not found for a deleted or unknown key', async () => {
    const { app } = await createTestServer()
    const start = await startRegistration(app, credentials())

    expect((await deleteKey(app, start.document.id)).status).toBe(204)

    const missing = await getKey(app, start.document.id)
    expect(missing.response.status).toBe(404)
    const body = missing.document as any
    expect(body.errors[0].title).toBe('Not Found')
    expect(body.errors[0].detail).toContain(start.document.id)
  })
})

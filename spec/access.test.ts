import { describe, expect, test } from 'bun:test'
import { normalizeAccess } from '../src/db/access.ts'
import { sessionKeyId } from '../src/auth/session-key.ts'
import { uuidToBuffer } from '../src/server/uuid.ts'
import { createAs, resourceDocument, signIn } from './helpers/session.ts'
import { createTestServer, JSON_API } from './helpers/test-server.ts'

/** POST without an Authorization header. */
const anonymousPost =
  (app: any, path: string, body: unknown) => {
    return app.request(
      path, { method: 'POST', headers: { 'content-type': JSON_API }, body: JSON.stringify(body) })
  }

describe('x-access create', () => {
  test('a create:"public" resource accepts anonymous creates with no owner', async () => {
    const { app } = await createTestServer({ session: true })
    const alice = await signIn(app, 'alice')

    const response =
      await anonymousPost(
        app, '/feedback'
        , resourceDocument('feedback', { message: 'Hi', owner: alice.userId }))
    expect(response.status).toBe(201)
    const doc = await response.json() as any
    expect(doc.data.attributes.owner).toBeNull()
    expect(doc.data.attributes.visibility).toBe('private')

    // Reads still need a session, and an ownerless private row is nobody's to read.
    expect((await app.request(`/feedback/${doc.data.id}`)).status).toBe(401)
    expect((await alice.request('GET', `/feedback/${doc.data.id}`)).status).toBe(404)
  })

  test('a signed-in creator owns what they create on a public-create resource', async () => {
    const { app } = await createTestServer({ session: true })
    const alice = await signIn(app, 'alice')
    const id = await createAs(alice, 'feedback', { message: 'Mine' })

    const doc = await (await alice.request('GET', `/feedback/${id}`)).json() as any
    expect(doc.data.attributes.owner).toBe(alice.userId)
  })

  test('resources without create:"public" reject anonymous creates', async () => {
    const { app } = await createTestServer({ session: true })
    const response =
      await anonymousPost(app, '/note', resourceDocument('note', { title: 'x' }))
    expect(response.status).toBe(401)
  })

  test('anonymous requests cannot update rows, even on a public-create resource', async () => {
    const { app } = await createTestServer({ session: true })
    const response =
      await anonymousPost(app, '/feedback', resourceDocument('feedback', { message: 'Hi' }))
    const id = ((await response.json()) as any).data.id
    const patch =
      await app.request(`/feedback/${id}`
        , { method: 'PATCH', headers: { 'content-type': JSON_API }
          , body: JSON.stringify({ data: { type: 'feedback', id, attributes: { message: 'x' } } }) })
    expect(patch.status).toBe(401)
  })
})

describe('x-access visibility', () => {
  test('defaults to private and only accepts the resource\'s allowed values', async () => {
    const { app } = await createTestServer({ session: true })
    const alice = await signIn(app, 'alice')

    const shared = await alice.request('POST', '/article', resourceDocument('article', { heading: 'Hi', content: 'x', visibility: 'shared' }))
    expect(shared.status).toBe(400)
    expect((await alice.request('POST', '/note', resourceDocument('note', { title: 'x', visibility: 'shared' }))).status).toBe(201)
  })

  test('the database rejects visibility values the schema does not allow', async () => {
    const { db } = await createTestServer()
    await expect(
      db.run(
        "INSERT INTO `article` (`id`, `visibility`) VALUES (?, 'shared')"
        , [uuidToBuffer(Bun.randomUUIDv7())]))
      .rejects.toThrow(/CHECK constraint failed/i)
  })
})

describe('x-access validation', () => {
  const schema = (access: unknown) => ({ title: 'Thing', type: 'object', 'x-access': access }) as any

  test('fills secure defaults', () => {
    expect(normalizeAccess(schema(undefined))).toEqual(
      { read: 'session'
      , create: 'session'
      , visibility: ['private', 'authenticated', 'public']
      , defaultVisibility: 'private'
      , shareable: false
      , signed: []
      , roles: {}
      , audited: []
      })
    expect(normalizeAccess(schema({ shareable: true })).visibility).toContain('shared')
    expect(normalizeAccess(schema({ signed: true })).signed).toEqual(['read', 'create', 'update', 'delete'])
  })

  test('rejects invalid settings', () => {
    for (const access of
      [ 'public'
      , { unknown: true }
      , { read: 'anyone' }
      , { create: true }
      , { visibility: ['shared'] }
      , { visibility: [] }
      , { defaultVisibility: 'public', visibility: ['private'] }
      , { signed: ['write'] }
      , { shareable: 'yes' }
      ])
      expect(() => normalizeAccess(schema(access))).toThrow(/x-access/)
  })
})

describe('session storage', () => {
  test('the key table stores a hash of the bearer token, never the token', async () => {
    const { app, db } = await createTestServer({ session: true })
    const alice = await signIn(app, 'alice')

    expect(await db.get('SELECT 1 AS x FROM `key` WHERE `id` = ?', [uuidToBuffer(alice.sessionId)])).toBeUndefined()
    expect(await db.get('SELECT 1 AS x FROM `key` WHERE `id` = ?', [sessionKeyId(alice.sessionId)])).toBeDefined()
    expect(alice.sessionId[14]).toBe('4')
  })
})

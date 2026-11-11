import { describe, expect, test } from 'bun:test'
import { credentials, login, register } from './helpers/auth-client.ts'
import { createTestServer } from './helpers/test-server.ts'

const jsonApiBody = (attributes: Record<string, unknown>) =>
  ({ data: { type: 'article', attributes } })

const articleOf =
  async (response: Response) => {
    const body = await response.json() as any
    if (!body.data) throw new Error(JSON.stringify(body))
    return body.data
  }

const authenticated =
  (app: any, sessionId: string, method: string, path: string, body?: unknown) => {
    const headers: Record<string, string> = { authorization: `Bearer ${sessionId}` }
    const init: any = { method, headers }
    if (body) {
      headers['content-type'] = 'application/vnd.api+json'
      headers.accept = 'application/vnd.api+json'
      init.body = JSON.stringify(body)
    }
    return app.request(path, init)
  }

const createArticle =
  async (app: any, sessionId: string, attributes?: Record<string, unknown>) =>
    await authenticated(app, sessionId, 'POST', '/article',
      jsonApiBody(attributes ?? { heading: 'A heading', content: 'Some content' }))

const readArticle =
  (app: any, sessionId: string, id: string) =>
    authenticated(app, sessionId, 'GET', `/article/${id}`)

const updateArticle =
  (app: any, sessionId: string, id: string, attributes: Record<string, unknown>) =>
    authenticated(app, sessionId, 'PATCH', `/article/${id}`, jsonApiBody(attributes))

const deleteArticle =
  (app: any, sessionId: string, id: string) =>
    authenticated(app, sessionId, 'DELETE', `/article/${id}`)

const listArticles =
  (app: any, sessionId: string) =>
    authenticated(app, sessionId, 'GET', '/article')

describe('OPAQUE resource authorization', () => {
  test('unauthenticated requests to resource routes are rejected', async () => {
    const { app } = await createTestServer({ session: true })

    expect((await app.request('/article', { method: 'GET' })).status).toBe(401)
    expect((await app.request('/article/xyz')).status).toBe(401)

    const post = await app.request('/article', {
      method: 'POST',
      headers: { 'content-type': 'application/vnd.api+json' },
      body: JSON.stringify(jsonApiBody({ heading: 'x', content: 'y' })),
    })
    expect(post.status).toBe(401)

    const patch = await app.request('/article/xyz', {
      method: 'PATCH',
      headers: { 'content-type': 'application/vnd.api+json' },
      body: JSON.stringify(jsonApiBody({ heading: 'x' })),
    })
    expect(patch.status).toBe(401)

    expect((await app.request('/article/xyz', { method: 'DELETE' })).status).toBe(401)
  })

  test('owner can read their own article', async () => {
    const { app } = await createTestServer({ session: true })
    const { userId: aliceId } = await register(app, credentials())
    const alice = await login(app, { username: 'alice', password: 'correct horse battery staple' })

    const created = await createArticle(app, alice.finish.document.sessionId)
    expect(created.status).toBe(201)
    const data = await articleOf(created)
    expect(data.attributes.owner).toBe(aliceId)

    const read = await readArticle(app, alice.finish.document.sessionId, data.id)
    expect(read.status).toBe(200)
    const readData = await articleOf(read)
    expect(readData.id).toBe(data.id)
  })

  test('non-owner cannot read another user\'s article', async () => {
    const { app } = await createTestServer({ session: true })

    await register(app, { ...credentials(), username: 'alice' })
    await register(app, { ...credentials(), username: 'bob' })

    const alice = await login(app, { username: 'alice', password: 'correct horse battery staple' })
    const bob = await login(app, { username: 'bob', password: 'correct horse battery staple' })

    const created = await createArticle(app, alice.finish.document.sessionId)
    expect(created.status).toBe(201)
    const data = await articleOf(created)

    // Bob tries to read Alice's article -> 404 (owner filter hides it)
    expect((await readArticle(app, bob.finish.document.sessionId, data.id)).status).toBe(404)

    // Alice can still read her own
    expect((await readArticle(app, alice.finish.document.sessionId, data.id)).status).toBe(200)
  })

  test('non-owner cannot update another user\'s article', async () => {
    const { app } = await createTestServer({ session: true })

    await register(app, { ...credentials(), username: 'alice' })
    await register(app, { ...credentials(), username: 'bob' })

    const alice = await login(app, { username: 'alice', password: 'correct horse battery staple' })
    const bob = await login(app, { username: 'bob', password: 'correct horse battery staple' })

    const created = await createArticle(app, alice.finish.document.sessionId)
    expect(created.status).toBe(201)
    const data = await articleOf(created)

    // Bob tries to update Alice's article -> 404
    expect((await updateArticle(app, bob.finish.document.sessionId, data.id, { heading: 'Hacked' })).status).toBe(404)

    // Alice can update her own
    const aliceUpdate = await updateArticle(app, alice.finish.document.sessionId, data.id, { heading: 'Updated by Alice' })
    expect(aliceUpdate.status).toBe(200)
    const updated = await articleOf(aliceUpdate)
    expect(updated.attributes.heading).toBe('Updated by Alice')
  })

  test('non-owner cannot delete another user\'s article', async () => {
    const { app } = await createTestServer({ session: true })

    await register(app, { ...credentials(), username: 'alice' })
    await register(app, { ...credentials(), username: 'bob' })

    const alice = await login(app, { username: 'alice', password: 'correct horse battery staple' })
    const bob = await login(app, { username: 'bob', password: 'correct horse battery staple' })

    const created = await createArticle(app, alice.finish.document.sessionId)
    expect(created.status).toBe(201)
    const data = await articleOf(created)

    // Bob tries to delete Alice's article -> 404
    expect((await deleteArticle(app, bob.finish.document.sessionId, data.id)).status).toBe(404)

    // Article still exists for Alice
    expect((await readArticle(app, alice.finish.document.sessionId, data.id)).status).toBe(200)

    // Alice can delete her own
    expect((await deleteArticle(app, alice.finish.document.sessionId, data.id)).status).toBe(204)

    // Gone after delete
    expect((await readArticle(app, alice.finish.document.sessionId, data.id)).status).toBe(404)
  })

  test('list only returns resources owned by the authenticated user', async () => {
    const { app } = await createTestServer({ session: true })

    await register(app, { ...credentials(), username: 'alice' })
    await register(app, { ...credentials(), username: 'bob' })

    const alice = await login(app, { username: 'alice', password: 'correct horse battery staple' })
    const bob = await login(app, { username: 'bob', password: 'correct horse battery staple' })

    const a1 = await createArticle(app, alice.finish.document.sessionId, { heading: 'Alice 1', content: 'c' })
    const a2 = await createArticle(app, alice.finish.document.sessionId, { heading: 'Alice 2', content: 'c' })
    expect(a1.status).toBe(201)
    expect(a2.status).toBe(201)

    const b1 = await createArticle(app, bob.finish.document.sessionId, { heading: 'Bob 1', content: 'c' })
    expect(b1.status).toBe(201)

    const aliceIds = new Set([(await articleOf(a1)).id, (await articleOf(a2)).id])
    const aliceList = await listArticles(app, alice.finish.document.sessionId)
    expect(aliceList.status).toBe(200)
    const aliceBody = await aliceList.json()
    expect(aliceBody.data).toHaveLength(2)
    for (const item of aliceBody.data)
      expect(aliceIds.has(item.id)).toBe(true)

    const bobList = await listArticles(app, bob.finish.document.sessionId)
    expect(bobList.status).toBe(200)
    const bobBody = await bobList.json()
    expect(bobBody.data).toHaveLength(1)
    expect(bobBody.data[0].id).toBe((await articleOf(b1)).id)
  })

  test('owner attribute is forced to the authenticated user on create', async () => {
    const { app } = await createTestServer({ session: true })

    await register(app, { ...credentials(), username: 'alice' })
    await register(app, { ...credentials(), username: 'bob' })

    const alice = await login(app, { username: 'alice', password: 'correct horse battery staple' })
    const bob = await login(app, { username: 'bob', password: 'correct horse battery staple' })

    // Alice tries to create an article claiming bob as owner
    const response = await authenticated(
      app, alice.finish.document.sessionId, 'POST', '/article',
      { data: { type: 'article', attributes: { heading: 'Hijack', content: 'c', owner: bob.finish.document.sessionId } } })

    expect(response.status).toBe(201)
    const data = await articleOf(response)
    // owner is forced to alice's user id, not bob's session id
    expect(data.attributes.owner).not.toBe(bob.finish.document.sessionId)
    expect(typeof data.attributes.owner).toBe('string')
    expect(data.attributes.owner.length).toBeGreaterThan(0)
  })
})

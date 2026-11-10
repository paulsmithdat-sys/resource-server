import { describe, expect, test } from 'bun:test'
import
  { createArticleAs
  , createAs
  , createTagAs
  , resourceDocument
  , signIn
  , toMany
  } from './helpers/session.ts'
import { createTestServer } from './helpers/test-server.ts'

const anonymous =
  (app: any, method: string, path: string, body?: unknown) => {
    // Purpose: send a request with no Authorization header
    return app.request(
      path
      , { method
        , headers: { accept: 'application/vnd.api+json', 'content-type': 'application/vnd.api+json' }
        , ...(body === undefined ? {} : { body: JSON.stringify(body) })
        })
  }

const ids =
  async (response: Response) => {
    // Purpose: list the resource ids in a JSON:API collection response
    const body = await response.json() as any
    return (body.data as any[]).map(x => x.id).sort()
  }

const publishArticle =
  (user: Awaited<ReturnType<typeof signIn>>, visibility: string, heading = 'Shared') => {
    // Purpose: create an article with the given visibility
    return createAs(user, 'article', { heading, content: 'Some content', visibility })
  }

describe('visibility: reads', () => {
  test('rows are private by default', async () => {
    const { app } = await createTestServer({ session: true })
    const alice = await signIn(app, 'alice')
    const bob = await signIn(app, 'bob')
    const id = await createArticleAs(alice)

    const own = await (await alice.request('GET', `/article/${id}`)).json() as any
    expect(own.data.attributes.visibility).toBe('private')
    expect((await bob.request('GET', `/article/${id}`)).status).toBe(404)
    expect(await ids(await bob.request('GET', '/article'))).toEqual([])
  })

  test('public and authenticated rows are readable by other signed-in users', async () => {
    const { app } = await createTestServer({ session: true })
    const alice = await signIn(app, 'alice')
    const bob = await signIn(app, 'bob')
    const pub = await publishArticle(alice, 'public')
    const auth = await publishArticle(alice, 'authenticated')
    const priv = await publishArticle(alice, 'private')

    expect((await bob.request('GET', `/article/${pub}`)).status).toBe(200)
    expect((await bob.request('GET', `/article/${auth}`)).status).toBe(200)
    expect((await bob.request('GET', `/article/${priv}`)).status).toBe(404)
    expect(await ids(await bob.request('GET', '/article'))).toEqual([auth, pub].sort())

    const page = await (await bob.request('GET', '/article')).json() as any
    expect(page.meta.page.total).toBe(2)
  })

  test('visibility changes take effect immediately and only the owner can make them', async () => {
    const { app } = await createTestServer({ session: true })
    const alice = await signIn(app, 'alice')
    const bob = await signIn(app, 'bob')
    const id = await createArticleAs(alice)
    const patch = (value: string) =>
      resourceDocument('article', { visibility: value })
        && { data: { type: 'article', id, attributes: { visibility: value } } }

    expect((await bob.request('PATCH', `/article/${id}`, patch('public'))).status).toBe(404)
    expect((await bob.request('GET', `/article/${id}`)).status).toBe(404)

    expect((await alice.request('PATCH', `/article/${id}`, patch('public'))).status).toBe(200)
    expect((await bob.request('GET', `/article/${id}`)).status).toBe(200)

    expect((await alice.request('PATCH', `/article/${id}`, patch('private'))).status).toBe(200)
    expect((await bob.request('GET', `/article/${id}`)).status).toBe(404)
  })

  test('readers of a public row still cannot write or delete it', async () => {
    const { app } = await createTestServer({ session: true })
    const alice = await signIn(app, 'alice')
    const bob = await signIn(app, 'bob')
    const id = await publishArticle(alice, 'public')

    const body = { data: { type: 'article', id, attributes: { heading: 'Hijacked' } } }
    expect((await bob.request('PATCH', `/article/${id}`, body)).status).toBe(404)
    expect((await bob.request('PUT', `/article/${id}`, body)).status).toBe(404)
    expect((await bob.request('DELETE', `/article/${id}`)).status).toBe(404)

    const stored = await (await alice.request('GET', `/article/${id}`)).json() as any
    expect(stored.data.attributes.heading).toBe('Shared')
  })

  test('rejects values outside private, authenticated and public', async () => {
    const { app } = await createTestServer({ session: true })
    const alice = await signIn(app, 'alice')

    for (const value of ['secret', 'PUBLIC', '', 1]) {
      const response =
        await alice.request(
          'POST', '/article'
          , resourceDocument('article', { heading: 'Hello', content: 'x', visibility: value }))
      expect({ value, status: response.status }).toEqual({ value, status: 400 })
    }
  })

  test('a related row the reader may not see is left out of linkage and includes', async () => {
    const { app } = await createTestServer({ session: true })
    const alice = await signIn(app, 'alice')
    const bob = await signIn(app, 'bob')
    const secret = await createTagAs(alice, 'secret')
    const open =
      await createAs(alice, 'tag', { name: 'open', kind: 'topic', visibility: 'public' })
    const article =
      await createAs(
        alice, 'article'
        , { heading: 'Mixed', content: 'x', visibility: 'public' }
        , { tag: toMany('tag', [secret, open]) })

    const read = async (user: typeof alice) =>
      await (await user.request('GET', `/article/${article}?include=tag`)).json() as any

    const seenByBob = await read(bob)
    expect(seenByBob.data.relationships.tag.data.map((x: any) => x.id)).toEqual([open])
    expect(seenByBob.included.map((x: any) => x.id)).toEqual([open])

    const seenByAlice = await read(alice)
    expect(seenByAlice.data.relationships.tag.data.map((x: any) => x.id).sort())
      .toEqual([open, secret].sort())
  })
})

describe('access: public resources', () => {
  test('tags can be listed and read without a session, but only public rows', async () => {
    const { app } = await createTestServer({ session: true })
    const alice = await signIn(app, 'alice')
    const hidden = await createTagAs(alice, 'hidden')
    const shared = await createAs(alice, 'tag', { name: 'shared', kind: 'topic', visibility: 'public' })
    const members = await createAs(alice, 'tag', { name: 'members', kind: 'topic', visibility: 'authenticated' })

    expect(await ids(await anonymous(app, 'GET', '/tag'))).toEqual([shared])
    expect((await anonymous(app, 'GET', `/tag/${shared}`)).status).toBe(200)
    expect((await anonymous(app, 'HEAD', `/tag/${shared}`)).status).toBe(200)
    expect((await anonymous(app, 'OPTIONS', '/tag')).status).toBe(204)
    expect((await anonymous(app, 'GET', `/tag/${hidden}`)).status).toBe(404)
    expect((await anonymous(app, 'GET', `/tag/${members}`)).status).toBe(404)

    const page = await (await anonymous(app, 'GET', '/tag')).json() as any
    expect(page.meta.page.total).toBe(1)
  })

  test('anonymous requests can never write to a public resource', async () => {
    const { app } = await createTestServer({ session: true })
    const alice = await signIn(app, 'alice')
    const shared = await createAs(alice, 'tag', { name: 'shared', kind: 'topic', visibility: 'public' })

    const body = { data: { type: 'tag', id: shared, attributes: { name: 'x' } } }
    expect((await anonymous(app, 'POST', '/tag', resourceDocument('tag', { name: 'x', kind: 'topic' }))).status).toBe(401)
    expect((await anonymous(app, 'PATCH', `/tag/${shared}`, body)).status).toBe(401)
    expect((await anonymous(app, 'PUT', `/tag/${shared}`, body)).status).toBe(401)
    expect((await anonymous(app, 'DELETE', `/tag/${shared}`)).status).toBe(401)
  })

  test('a session that is sent is always validated, even on public resources', async () => {
    const { app } = await createTestServer({ session: true })

    for (const header of ['Bearer not-a-uuid', 'Bearer 01940000-0000-7000-8000-00000000dead', 'Basic abc']) {
      const response = await app.request('/tag', { headers: { authorization: header } })
      expect({ header, status: response.status }).toEqual({ header, status: 401 })
    }
  })

  test('resources that are not public still need a session for anonymous reads', async () => {
    const { app } = await createTestServer({ session: true })
    const alice = await signIn(app, 'alice')
    const id = await publishArticle(alice, 'public')

    expect((await anonymous(app, 'GET', '/article')).status).toBe(401)
    expect((await anonymous(app, 'GET', `/article/${id}`)).status).toBe(401)
  })
})

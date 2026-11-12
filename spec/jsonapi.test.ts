import { describe, expect, test } from 'bun:test'
import
  { bearer
  , createAs
  , createArticleAs
  , createTagAs
  , resourceDocument
  , signIn
  , toMany
  , type SignedIn
  } from './helpers/session.ts'
import { createTestServer, JSON_API } from './helpers/test-server.ts'

const json =
  async (response: Response) => await response.json() as any

/** List article headings matching a query string, sorted. */
const headings =
  async (user: SignedIn, query: string) => {
    const response = await user.request('GET', `/article?${query}`)
    if (response.status !== 200) return response.status
    return ((await json(response)).data as any[]).map(x => x.attributes.heading).sort()
  }

/** A server with one user and three articles. */
const seed =
  async () => {
    const { app } = await createTestServer({ session: true })
    const alice = await signIn(app, 'alice')
    await createAs(alice, 'article', { heading: 'Alpha one', content: 'x', subheading: 'sub' })
    await createAs(alice, 'article', { heading: 'Beta two', content: 'x' })
    await createAs(alice, 'article', { heading: 'Gamma 100%', content: 'x' })
    return { app, alice }
  }

describe('filters', () => {
  test('supports every comparison operator', async () => {
    const { alice } = await seed()

    expect(await headings(alice, 'filter[heading]=Beta two')).toEqual(['Beta two'])
    expect(await headings(alice, 'filter[heading][eq]=Beta two')).toEqual(['Beta two'])
    expect(await headings(alice, 'filter[heading][ne]=Beta two')).toEqual(['Alpha one', 'Gamma 100%'])
    expect(await headings(alice, 'filter[heading][gt]=Beta two')).toEqual(['Gamma 100%'])
    expect(await headings(alice, 'filter[heading][ge]=Beta two')).toEqual(['Beta two', 'Gamma 100%'])
    expect(await headings(alice, 'filter[heading][lt]=Beta two')).toEqual(['Alpha one'])
    expect(await headings(alice, 'filter[heading][le]=Beta two')).toEqual(['Alpha one', 'Beta two'])
    expect(await headings(alice, 'filter[heading][in]=Alpha one,Beta two')).toEqual(['Alpha one', 'Beta two'])
    expect(await headings(alice, 'filter[heading][nin]=Alpha one,Beta two')).toEqual(['Gamma 100%'])
    expect(await headings(alice, 'filter[heading][contains]=a t')).toEqual(['Beta two'])
    expect(await headings(alice, 'filter[heading][starts]=Gam')).toEqual(['Gamma 100%'])
    expect(await headings(alice, 'filter[heading][ends]=one')).toEqual(['Alpha one'])
    expect(await headings(alice, 'filter[subheading][null]=true')).toEqual(['Beta two', 'Gamma 100%'])
    expect(await headings(alice, 'filter[subheading][null]=false')).toEqual(['Alpha one'])
  })

  test('combines filters with AND and treats LIKE wildcards literally', async () => {
    const { alice } = await seed()

    expect(await headings(alice, 'filter[heading][contains]=a&filter[heading][ends]=two')).toEqual(['Beta two'])
    expect(await headings(alice, 'filter[heading][contains]=%25')).toEqual(['Gamma 100%'])
    expect(await headings(alice, 'filter[heading][contains]=_')).toEqual([])
  })

  test('converts values to the column type', async () => {
    const { alice } = await seed()
    const future = new Date(Date.now() + 3_600_000).toISOString()

    expect((await headings(alice, 'filter[updated_at][gt]=0') as string[]).length).toBe(3)
    expect(await headings(alice, `filter[updated_at][gt]=${encodeURIComponent(future)}`)).toEqual([])
    expect(await headings(alice, 'filter[updated_at][gt]=yesterday')).toBe(400)
  })

  test('rejects unknown operators, fields and malformed filters', async () => {
    const { alice } = await seed()

    expect(await headings(alice, 'filter[heading][regex]=x')).toBe(400)
    expect(await headings(alice, 'filter[nope]=x')).toBe(400)
    expect(await headings(alice, 'filter[heading][a][b]=x')).toBe(400)
    expect(await headings(alice, 'filter=x')).toBe(400)
    expect(await headings(alice, 'filter[subheading][null]=maybe')).toBe(400)
    expect(await headings(alice, "filter[heading][contains]=' OR 1=1 --")).toEqual([])
  })
})

describe('links and document structure', () => {
  test('documents carry the version, self links and relationship links', async () => {
    const { app } = await createTestServer({ session: true })
    const alice = await signIn(app, 'alice')
    const tag = await createTagAs(alice)
    const id = await createArticleAs(alice, 'Hello', { tag: toMany('tag', [tag]) })

    const doc = await json(await alice.request('GET', `/article/${id}?include=tag`))
    expect(doc.jsonapi).toEqual({ version: '1.1' })
    expect(doc.links.self).toBe(`http://localhost/article/${id}?include=tag`)
    expect(doc.data.links.self).toBe(`http://localhost/article/${id}`)
    expect(doc.data.relationships.tag.links).toEqual(
      { self: `http://localhost/article/${id}/relationships/tag`
      , related: `http://localhost/article/${id}/tag`
      })
    expect(doc.included[0].links.self).toBe(`http://localhost/tag/${tag}`)
  })

  test('collections carry pagination links', async () => {
    const { alice } = await seed()

    const first = await json(await alice.request('GET', '/article?page[size]=1&sort=heading'))
    expect(first.links.prev).toBeNull()
    expect(first.meta.page).toEqual({ number: 1, size: 1, total: 3, pages: 3 })

    const second = await json(await alice.request('GET', new URL(first.links.next).pathname + new URL(first.links.next).search))
    expect(second.data[0].attributes.heading).toBe('Beta two')
    expect(new URL(second.links.prev).searchParams.get('page[number]')).toBe('1')
    expect(new URL(second.links.last).searchParams.get('page[number]')).toBe('3')
    expect(new URL(second.links.next).searchParams.get('sort')).toBe('heading')

    const last = await json(await alice.request('GET', '/article?page[size]=1&page[number]=3'))
    expect(last.links.next).toBeNull()
  })

  test('sparse fieldsets leave out relationships that were not asked for', async () => {
    const { app } = await createTestServer({ session: true })
    const alice = await signIn(app, 'alice')
    const tag = await createTagAs(alice)
    const id = await createArticleAs(alice, 'Hello', { tag: toMany('tag', [tag]) })

    const sparse = await json(await alice.request('GET', `/article/${id}?fields[article]=heading`))
    expect(sparse.data.attributes).toEqual({ heading: 'Hello' })
    expect(sparse.data.relationships?.tag).toBeUndefined()

    const linkage = await json(await alice.request('GET', `/article/${id}`))
    expect(linkage.data.relationships.tag.data).toEqual([{ type: 'tag', id: tag }])
    expect(linkage.included).toBeUndefined()
  })
})

describe('relationship endpoints', () => {
  /** An article with one of two tags, plus a second user. */
  const setup =
    async () => {
      const { app } = await createTestServer({ session: true })
      const alice = await signIn(app, 'alice')
      const bob = await signIn(app, 'bob')
      const one = await createTagAs(alice, 'one')
      const two = await createTagAs(alice, 'two')
      const article = await createArticleAs(alice, 'Hello', { tag: toMany('tag', [one]) })
      return { app, alice, bob, one, two, article, path: `/article/${article}/relationships/tag` }
    }

  test('reads resource linkage', async () => {
    const { alice, one, article, path } = await setup()

    const doc = await json(await alice.request('GET', path))
    expect(doc.data).toEqual([{ type: 'tag', id: one }])
    expect(doc.links).toEqual(
      { self: `http://localhost/article/${article}/relationships/tag`
      , related: `http://localhost/article/${article}/tag`
      })
  })

  test('PATCH replaces, POST adds and DELETE removes members', async () => {
    const { alice, one, two, path } = await setup()
    const linkage = async () => ((await json(await alice.request('GET', path))).data as any[]).map(x => x.id).sort()

    expect((await alice.request('POST', path, toMany('tag', [two]))).status).toBe(200)
    expect(await linkage()).toEqual([one, two].sort())
    expect((await alice.request('POST', path, toMany('tag', [two]))).status).toBe(200)
    expect(await linkage()).toEqual([one, two].sort())

    expect((await alice.request('DELETE', path, toMany('tag', [one]))).status).toBe(200)
    expect(await linkage()).toEqual([two])

    expect((await alice.request('PATCH', path, toMany('tag', [one]))).status).toBe(200)
    expect(await linkage()).toEqual([one])
    expect((await alice.request('PATCH', path, toMany('tag', []))).status).toBe(200)
    expect(await linkage()).toEqual([])
  })

  test('applies the same ownership rules as the resource itself', async () => {
    const { app, alice, bob, one, path } = await setup()
    const bobsTag = await createTagAs(bob, 'bobs')

    expect((await bob.request('GET', path)).status).toBe(404)
    expect((await bob.request('PATCH', path, toMany('tag', []))).status).toBe(404)
    expect((await bob.request('POST', path, toMany('tag', [bobsTag]))).status).toBe(404)
    expect((await bob.request('DELETE', path, toMany('tag', [one]))).status).toBe(404)
    expect((await alice.request('POST', path, toMany('tag', [bobsTag]))).status).toBe(404)
    expect((await app.request(path)).status).toBe(401)

    expect((await json(await alice.request('GET', path))).data).toEqual([{ type: 'tag', id: one }])
  })

  test('validates the relationship name, body and cardinality', async () => {
    const { alice, one, article, path } = await setup()

    expect((await alice.request('GET', `/article/${article}/relationships/nope`)).status).toBe(404)
    expect((await alice.request('PATCH', path, { data: { type: 'tag', id: one } })).status).toBe(400)
    expect((await alice.request('PATCH', path, toMany('article', [article]))).status).toBe(400)
    expect((await alice.request('PATCH', path, {})).status).toBe(400)

    const joins = await json(await alice.request('GET', '/article_tag'))
    const toOne = `/article_tag/${joins.data[0].id}/relationships/tag`
    expect((await alice.request('POST', toOne, toMany('tag', [one]))).status).toBe(403)
    expect((await json(await alice.request('GET', toOne))).data).toEqual({ type: 'tag', id: one })
  })
})

describe('related resource endpoints', () => {
  test('a to-many related link is a full collection with filters and pagination', async () => {
    const { app } = await createTestServer({ session: true })
    const alice = await signIn(app, 'alice')
    const one = await createTagAs(alice, 'one')
    const two = await createTagAs(alice, 'two')
    await createTagAs(alice, 'unlinked')
    const article = await createArticleAs(alice, 'Hello', { tag: toMany('tag', [one, two]) })

    const all = await json(await alice.request('GET', `/article/${article}/tag?sort=name`))
    expect(all.data.map((x: any) => x.attributes.name)).toEqual(['one', 'two'])
    expect(all.meta.page.total).toBe(2)

    const filtered = await json(await alice.request('GET', `/article/${article}/tag?filter[name]=two`))
    expect(filtered.data.map((x: any) => x.id)).toEqual([two])
  })

  test('a to-one related link is a single resource, or null', async () => {
    const { app } = await createTestServer({ session: true })
    const alice = await signIn(app, 'alice')
    const bob = await signIn(app, 'bob')
    const note = await createAs(alice, 'note', { title: 'N', visibility: 'shared' })
    const share =
      await createAs(
        alice, 'note_share', {}
        , { note: { data: { type: 'note', id: note } }, user: { data: { type: 'user', id: bob.userId } } })

    const related = await json(await alice.request('GET', `/note_share/${share}/note`))
    expect(related.data.id).toBe(note)
    expect(related.data.type).toBe('note')

    const none = await json(await alice.request('GET', `/note_share/${share}/user_group`))
    expect(none.data).toBeNull()
  })

  test('only shows related rows the reader may see', async () => {
    const { app } = await createTestServer({ session: true })
    const alice = await signIn(app, 'alice')
    const bob = await signIn(app, 'bob')
    const secret = await createTagAs(alice, 'secret')
    const open = await createAs(alice, 'tag', { name: 'open', kind: 'topic', visibility: 'public' })
    const article =
      await createAs(
        alice, 'article', { heading: 'Mixed', content: 'x', visibility: 'public' }
        , { tag: toMany('tag', [secret, open]) })

    const seen = await json(await bob.request('GET', `/article/${article}/tag`))
    expect(seen.data.map((x: any) => x.id)).toEqual([open])
    const linkage = await json(await bob.request('GET', `/article/${article}/relationships/tag`))
    expect(linkage.data).toEqual([{ type: 'tag', id: open }])

    const hidden = await createArticleAs(alice, 'Hidden')
    expect((await bob.request('GET', `/article/${hidden}/tag`)).status).toBe(404)
  })
})

describe('content negotiation', () => {
  test('rejects request bodies that are not JSON:API with 415', async () => {
    const { app } = await createTestServer({ session: true })
    const alice = await signIn(app, 'alice')
    const post = (type: string) =>
      app.request('/article'
        , { method: 'POST'
          , headers: { authorization: bearer(alice.sessionId), 'content-type': type }
          , body: JSON.stringify(resourceDocument('article', { heading: 'Hello', content: 'x' }))
          })

    expect((await post('application/json')).status).toBe(415)
    expect((await post(`${JSON_API}; charset=utf-8`)).status).toBe(415)
    expect((await post('application/vnd.api+json-patch+json')).status).toBe(415)
    expect((await post(JSON_API)).status).toBe(201)
    expect((await post(`${JSON_API}; profile="https://example.com/p"`)).status).toBe(201)
  })

  test('rejects Accept headers that only allow parameterised JSON:API with 406', async () => {
    const { app } = await createTestServer({ session: true })
    const alice = await signIn(app, 'alice')
    const get = (accept: string) =>
      app.request('/article', { headers: { authorization: bearer(alice.sessionId), accept } })

    expect((await get(`${JSON_API}; version=2`)).status).toBe(406)
    expect((await get(`${JSON_API};q=0`)).status).toBe(406)
    expect((await get(`${JSON_API}; version=2, ${JSON_API}`)).status).toBe(200)
    expect((await get(`${JSON_API}; profile="https://example.com/a,b"`)).status).toBe(200)
    expect((await get('*/*')).status).toBe(200)
    expect((await get(JSON_API)).headers.get('content-type')).toBe(JSON_API)
  })
})

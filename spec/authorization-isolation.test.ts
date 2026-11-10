import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, test } from 'bun:test'
import { uuidToBuffer } from '../src/server/uuid.ts'
import { login } from './helpers/auth-client.ts'
import
  { PASSWORD
  , createArticleAs
  , createTagAs
  , resourceDocument
  , signIn
  , toMany
  , toOne
  } from './helpers/session.ts'
import { createTestServer } from './helpers/test-server.ts'

const twoUsers =
  async () => {
    // Purpose: build a session-protected server with alice and bob signed in
    const server = await createTestServer({ session: true })
    const alice = await signIn(server.app, 'alice')
    const bob = await signIn(server.app, 'bob')
    return { ...server, alice, bob }
  }

const body = async (response: Response) => await response.json() as any

describe('cross-user isolation on every method', () => {
  const methods =
    [ { method: 'GET', expected: 404 }
    , { method: 'HEAD', expected: 404 }
    , { method: 'PUT', expected: 404 }
    , { method: 'PATCH', expected: 404 }
    , { method: 'DELETE', expected: 404 }
    ] as const

  for (const resource of ['article', 'tag'] as const) {
    for (const { method, expected } of methods) {
      test(`${method} /${resource}/:id on another user's row is ${expected} and changes nothing`, async () => {
        const { alice, bob } = await twoUsers()
        const id =
          resource === 'article'
            ? await createArticleAs(bob, 'Bob heading')
            : await createTagAs(bob, 'bob-tag')
        const attributes =
          resource === 'article'
            ? { heading: 'Hijacked', content: 'x' }
            : { name: 'hijacked', kind: 'topic' }

        const response =
          await alice.request(
            method
            , `/${resource}/${id}`
            , method === 'PUT' || method === 'PATCH'
                ? resourceDocument(resource, attributes)
                : undefined)
        expect(response.status).toBe(expected)

        const intact = await bob.request('GET', `/${resource}/${id}`)
        expect(intact.status).toBe(200)
        const data = (await body(intact)).data
        expect(data.attributes.owner).toBe(bob.userId)
        expect(JSON.stringify(data.attributes)).not.toContain('Hijacked')
        expect(JSON.stringify(data.attributes)).not.toContain('hijacked')
      })
    }
  }

  test('a 404 for another user\'s row is indistinguishable from a 404 for a missing row', async () => {
    const { alice, bob } = await twoUsers()
    const foreign = await createArticleAs(bob)

    const foreignResponse = await alice.request('GET', `/article/${foreign}`)
    const missingResponse =
      await alice.request('GET', '/article/01940000-0000-7000-8000-00000000beef')

    expect(foreignResponse.status).toBe(missingResponse.status)
    const strip = (text: string, id: string) => text.replaceAll(id, '<id>')
    expect(strip(await foreignResponse.text(), foreign)).toBe(
      strip(await missingResponse.text(), '01940000-0000-7000-8000-00000000beef'))
  })
})

describe('ownership cannot be reassigned', () => {
  test('PATCH cannot hand a row to another user', async () => {
    const { alice, bob } = await twoUsers()
    const id = await createArticleAs(alice)

    const response =
      await alice.request(
        'PATCH', `/article/${id}`, resourceDocument('article', { owner: bob.userId }))

    if (response.status === 200)
      expect((await body(response)).data.attributes.owner).toBe(alice.userId)
    expect((await bob.request('GET', `/article/${id}`)).status).toBe(404)
    expect((await alice.request('GET', `/article/${id}`)).status).toBe(200)
  })

  test('PUT cannot hand a row to another user', async () => {
    const { alice, bob } = await twoUsers()
    const id = await createArticleAs(alice)

    const response =
      await alice.request(
        'PUT'
        , `/article/${id}`
        , resourceDocument(
            'article'
            , { heading: 'Still mine', content: 'c', owner: bob.userId }))

    if (response.status === 200)
      expect((await body(response)).data.attributes.owner).toBe(alice.userId)
    expect((await bob.request('GET', `/article/${id}`)).status).toBe(404)
    expect((await alice.request('GET', `/article/${id}`)).status).toBe(200)
  })

  test('PUT without an owner does not orphan the row', async () => {
    const { alice, bob } = await twoUsers()
    const id = await createArticleAs(alice)

    const response =
      await alice.request(
        'PUT'
        , `/article/${id}`
        , resourceDocument('article', { heading: 'No owner given', content: 'c' }))

    expect(response.status).toBe(200)
    expect((await body(response)).data.attributes.owner).toBe(alice.userId)
    expect((await alice.request('GET', `/article/${id}`)).status).toBe(200)
    expect((await bob.request('GET', `/article/${id}`)).status).toBe(404)
  })

  test('PATCH with a null owner does not orphan the row', async () => {
    const { alice } = await twoUsers()
    const id = await createArticleAs(alice)

    const response =
      await alice.request(
        'PATCH', `/article/${id}`, resourceDocument('article', { owner: null }))

    if (response.status === 200)
      expect((await body(response)).data.attributes.owner).toBe(alice.userId)
    expect((await alice.request('GET', `/article/${id}`)).status).toBe(200)
  })

  test('a client-chosen id cannot overwrite another user\'s row', async () => {
    const { alice, bob } = await twoUsers()
    const id = await createArticleAs(bob, 'Bob original')

    const response =
      await alice.request(
        'POST'
        , '/article'
        , { data:
            { type: 'article'
            , id
            , attributes: { heading: 'Alice takeover', content: 'c' }
            }
          })

    expect(response.status).toBeGreaterThanOrEqual(400)
    const intact = await bob.request('GET', `/article/${id}`)
    expect((await body(intact)).data.attributes.heading).toBe('Bob original')
  })
})

describe('visibility of unowned and foreign rows', () => {
  test('rows without an owner are invisible and immutable to signed-in users', async () => {
    const { db, alice } = await twoUsers()
    const orphanId = '01940000-0000-7000-8000-0000000000aa'
    await db.run(
      'INSERT INTO `tag` (`id`, `name`, `kind`) VALUES (?, ?, ?)'
      , [uuidToBuffer(orphanId), 'orphan', 'topic'])

    expect((await alice.request('GET', `/tag/${orphanId}`)).status).toBe(404)
    expect((await alice.request('PATCH', `/tag/${orphanId}`, resourceDocument('tag', { name: 'mine' }))).status).toBe(404)
    expect((await alice.request('DELETE', `/tag/${orphanId}`)).status).toBe(404)

    const list = await body(await alice.request('GET', '/tag'))
    expect(list.data).toEqual([])
    expect(list.meta.page.total).toBe(0)
  })

  test('list totals and pages count only the caller\'s rows', async () => {
    const { alice, bob } = await twoUsers()
    await createTagAs(alice, 'alice-1')
    for (const n of [1, 2, 3]) await createTagAs(bob, `bob-${n}`)

    const list = await body(await alice.request('GET', '/tag?page[size]=1'))
    expect(list.meta.page.total).toBe(1)
    expect(list.meta.page.pages).toBe(1)
    expect(list.data).toHaveLength(1)
    expect(list.data[0].attributes.name).toBe('alice-1')

    const second = await body(await alice.request('GET', '/tag?page[size]=1&page[number]=2'))
    expect(second.data).toEqual([])
  })

  test('filters, sorts and sparse fieldsets cannot widen the owner scope', async () => {
    const { alice, bob } = await twoUsers()
    await createTagAs(alice, 'alice-tag')
    await createTagAs(bob, 'bob-tag')

    const viaOwnerFilter =
      await body(await alice.request('GET', `/tag?filter[owner]=${bob.userId}`))
    expect(viaOwnerFilter.data).toEqual([])
    expect(viaOwnerFilter.meta.page.total).toBe(0)

    const viaNameFilter =
      await body(await alice.request('GET', '/tag?filter[name]=bob-tag'))
    expect(viaNameFilter.data).toEqual([])

    const sorted = await body(await alice.request('GET', '/tag?sort=-name'))
    expect(sorted.data.map((x: any) => x.attributes.name)).toEqual(['alice-tag'])

    const sparse = await body(await alice.request('GET', '/tag?fields[tag]=name'))
    expect(sparse.data.map((x: any) => x.attributes.name)).toEqual(['alice-tag'])
  })

  test('SQL metacharacters in filters do not bypass the owner scope', async () => {
    const { alice, bob } = await twoUsers()
    await createTagAs(alice, 'alice-tag')
    await createTagAs(bob, 'bob-tag')

    for (const value of ["x' OR '1'='1", "x') OR 1=1 --", '%', '*']) {
      const response =
        await alice.request('GET', `/tag?filter[name]=${encodeURIComponent(value)}`)
      expect(response.status).toBe(200)
      expect((await body(response)).data).toEqual([])
    }

    const unknownColumn =
      await alice.request('GET', `/tag?filter[${encodeURIComponent('owner` OR 1=1 --')}]=x`)
    expect(unknownColumn.status).toBe(400)
  })
})

describe('related resources do not cross owners', () => {
  test('an article cannot be linked to another user\'s tag, or the tag does not leak through include', async () => {
    const { alice, bob } = await twoUsers()
    const bobTag = await createTagAs(bob, 'bob-secret-tag')

    const created =
      await alice.request(
        'POST'
        , '/article'
        , resourceDocument(
            'article'
            , { heading: 'Alice article', content: 'c' }
            , { tag: toMany('tag', [bobTag]) }))

    if (created.status >= 400) {
      expect(created.status).toBeLessThan(500)
      return
    }

    const id = (await body(created)).data.id
    const read = await body(await alice.request('GET', `/article/${id}?include=tag`))
    const text = JSON.stringify(read)
    expect(text).not.toContain('bob-secret-tag')
    expect(text).not.toContain(bobTag)
  })

  test('an update cannot link an article to another user\'s tag, or the tag does not leak', async () => {
    const { alice, bob } = await twoUsers()
    const bobTag = await createTagAs(bob, 'bob-secret-tag')
    const id = await createArticleAs(alice)

    const patched =
      await alice.request(
        'PATCH'
        , `/article/${id}`
        , resourceDocument('article', {}, { tag: toMany('tag', [bobTag]) }))

    if (patched.status >= 400) {
      expect(patched.status).toBeLessThan(500)
      return
    }

    const read = await body(await alice.request('GET', `/article/${id}?include=tag`))
    const text = JSON.stringify(read)
    expect(text).not.toContain('bob-secret-tag')
    expect(text).not.toContain(bobTag)
  })

  test('a join row cannot attach another user\'s article to the caller\'s tag', async () => {
    const { alice, bob } = await twoUsers()
    const bobArticle = await createArticleAs(bob, 'Bob article')
    const aliceTag = await createTagAs(alice, 'alice-injected-tag')

    const attempt =
      await alice.request(
        'POST'
        , '/article_tag'
        , resourceDocument(
            'article_tag'
            , {}
            , { article: toOne('article', bobArticle), tag: toOne('tag', aliceTag) }))
    expect(attempt.status).toBeLessThan(500)

    const read = await body(await bob.request('GET', `/article/${bobArticle}?include=tag`))
    const text = JSON.stringify(read)
    expect(text).not.toContain('alice-injected-tag')
    expect(text).not.toContain(aliceTag)
  })

  test('deleting your own tag does not alter another user\'s article', async () => {
    const { alice, bob } = await twoUsers()
    const aliceTag = await createTagAs(alice, 'alice-tag')
    const bobArticle = await createArticleAs(bob, 'Bob article')

    await alice.request('DELETE', `/tag/${aliceTag}`)

    const read = await bob.request('GET', `/article/${bobArticle}`)
    expect(read.status).toBe(200)
    expect((await body(read)).data.attributes.heading).toBe('Bob article')
  })

  test('your own tags are still included on your own articles', async () => {
    const { alice } = await twoUsers()
    const tag = await createTagAs(alice, 'alice-tag')
    const id =
      await createArticleAs(
        alice, 'Tagged', { tag: toMany('tag', [tag]) })

    const read = await body(await alice.request('GET', `/article/${id}?include=tag`))
    expect(read.included).toHaveLength(1)
    expect(read.included[0].id).toBe(tag)
    expect(read.included[0].attributes.name).toBe('alice-tag')
  })
})

describe('system resources', () => {
  test('a user can read only their own user row', async () => {
    const { alice, bob } = await twoUsers()

    const own = await alice.request('GET', `/user/${alice.userId}`)
    expect(own.status).toBe(200)
    expect((await body(own)).data.attributes.username).toBe('alice')

    expect((await alice.request('GET', `/user/${bob.userId}`)).status).toBe(404)

    const list = await body(await alice.request('GET', '/user'))
    expect(list.data.map((x: any) => x.id)).toEqual([alice.userId])
    expect(JSON.stringify(list)).not.toContain('bob@example.com')
  })

  test('a user cannot modify or delete another user\'s account', async () => {
    const { app, alice, bob } = await twoUsers()

    const patch =
      await alice.request(
        'PATCH'
        , `/user/${bob.userId}`
        , resourceDocument('user', { email: 'attacker@example.com' }))
    expect(patch.status).toBe(404)
    expect((await alice.request('DELETE', `/user/${bob.userId}`)).status).toBe(404)

    const read = await body(await bob.request('GET', `/user/${bob.userId}`))
    expect(read.data.attributes.email).toBe('bob@example.com')

    const again = await login(app, { username: 'bob', password: PASSWORD })
    expect(again.finish.response.status).toBe(200)
  })

  test('user documents never expose key material, session ids or OPAQUE state', async () => {
    const { alice } = await twoUsers()

    const text =
      JSON.stringify(await body(await alice.request('GET', `/user/${alice.userId}?include=groups`)))
    for (const secret of [alice.sessionId, 'material', 'jwk', 'registrationRecord', 'serverLoginState'])
      expect(text).not.toContain(secret)
  })

  test('the key table is unreachable through the generic resource routes', async () => {
    const { alice } = await twoUsers()

    expect((await alice.request('GET', '/key')).status).toBe(404)

    const catalog = await body(await alice.request('GET', '/'))
    expect(catalog.meta.resources.map((x: any) => x.type)).not.toContain('key')
  })

  test('schema rows without an owner are hidden from signed-in users', async () => {
    const { db, alice } = await twoUsers()
    await db.run(
      'INSERT INTO `schema` (`id`, `table_name`, `jsonschema`) VALUES (?, ?, ?)'
      , [uuidToBuffer('01940000-0000-7000-8000-0000000000bb'), 'secret_table', '{}'])

    const list = await body(await alice.request('GET', '/schema'))
    expect(JSON.stringify(list)).not.toContain('secret_table')
  })
})

describe('concurrent requests', () => {
  test('interleaved creates by different users each get the right owner', async () => {
    const { alice, bob } = await twoUsers()

    const jobs =
      Array.from({ length: 16 }, (_, n) => {
        const user = n % 2 === 0 ? alice : bob
        return user
          .request('POST', '/article', resourceDocument('article', { heading: `${user.name}-${n}`, content: 'c' }))
          .then(async response => ({ user, n, response, doc: await body(response) }))
      })
    const results = await Promise.all(jobs)

    for (const { user, n, response, doc } of results) {
      expect({ n, status: response.status }).toEqual({ n, status: 201 })
      expect({ n, owner: doc.data.attributes.owner }).toEqual({ n, owner: user.userId })
    }

    const aliceList = await body(await alice.request('GET', '/article'))
    const bobList = await body(await bob.request('GET', '/article'))
    expect(aliceList.data).toHaveLength(8)
    expect(bobList.data).toHaveLength(8)
    for (const item of aliceList.data) expect(item.attributes.heading.startsWith('alice-')).toBe(true)
    for (const item of bobList.data) expect(item.attributes.heading.startsWith('bob-')).toBe(true)
  })

  test('interleaved updates and deletes never touch the other user\'s rows', async () => {
    const { alice, bob } = await twoUsers()
    const aliceIds = await Promise.all([1, 2, 3, 4].map(n => createArticleAs(alice, `alice-${n}`)))
    const bobIds = await Promise.all([1, 2, 3, 4].map(n => createArticleAs(bob, `bob-${n}`)))

    const jobs =
      [ ...aliceIds.map(id => alice.request('PATCH', `/article/${id}`, resourceDocument('article', { subheading: 'by alice' })))
      , ...bobIds.map(id => bob.request('PATCH', `/article/${id}`, resourceDocument('article', { subheading: 'by bob' })))
      , ...bobIds.slice(0, 2).map(id => alice.request('DELETE', `/article/${id}`))
      ]
    await Promise.all(jobs)

    for (const id of aliceIds) {
      const doc = (await body(await alice.request('GET', `/article/${id}`))).data
      expect(doc.attributes.subheading).toBe('by alice')
    }
    for (const id of bobIds) {
      const response = await bob.request('GET', `/article/${id}`)
      expect(response.status).toBe(200)
      expect((await body(response)).data.attributes.subheading).toBe('by bob')
    }
  })
})

describe('server entry point', () => {
  test('enables session enforcement when it wires up authentication', async () => {
    const source = await readFile(join(import.meta.dir, '../src/server/index.ts'), 'utf8')

    expect(source).toMatch(/requireSession\s*:\s*true/)
  })
})

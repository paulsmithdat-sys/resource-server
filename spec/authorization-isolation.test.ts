import { describe, expect, test } from 'bun:test'
import { uuidToBuffer } from '../src/server/uuid.ts'
import { createArticleAs, createTagAs, resourceDocument } from './helpers/session.ts'
import { twoUsers, body } from './helpers/two-users.ts'

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

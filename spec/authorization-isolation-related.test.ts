import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, test } from 'bun:test'
import { uuidToBuffer } from '../src/server/uuid.ts'
import { login } from './helpers/auth-client.ts'
import { PASSWORD, createArticleAs, createTagAs, resourceDocument, toMany, toOne } from './helpers/session.ts'
import { twoUsers, body } from './helpers/two-users.ts'

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
        , resourceDocument('user', { display_name: 'attacker' }))
    expect(patch.status).toBe(404)
    expect((await alice.request('DELETE', `/user/${bob.userId}`)).status).toBe(404)

    const read = await body(await bob.request('GET', `/user/${bob.userId}`))
    expect(read.data.attributes.display_name).toBe('bob')

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

describe('server start-up', () => {
  test('enables session enforcement when it wires up authentication', async () => {
    const source = await readFile(join(import.meta.dir, '../src/server/start.ts'), 'utf8')

    expect(source).toMatch(/requireSession\s*:\s*true/)
  })
})

import { describe, expect, test } from 'bun:test'
import { createAs, createTagAs, toMany, toOne } from './helpers/session.ts'
import { twoUsers } from './helpers/two-users.ts'

type Document =
  { data: { id: string }[]
  , errors?: { status: string, source?: { parameter?: string } }[]
  }

/** Alice's public article, tagged with her private tag "secret" and her public tag "open". */
const tagged =
  async () => {
    const world = await twoUsers()
    const secret = await createTagAs(world.alice, 'secret')
    const open = await createAs(world.alice, 'tag', { name: 'open', kind: 'topic', visibility: 'public' })
    const article =
      await createAs(
        world.alice, 'article', { heading: 'Tagged', content: 'c', visibility: 'public' }
        , { tag: toMany('tag', [secret, open]) })
    const plain = await createAs(world.alice, 'article', { heading: 'Plain', content: 'c', visibility: 'public' })
    return { ...world, secret, open, article, plain }
  }

const ids =
  async (response: Response) => ((await response.json()) as Document).data.map(x => x.id)

describe('filters on related resources', () => {
  test('filter[rel.field] keeps rows with a matching related row', async () => {
    const { alice, article } = await tagged()
    expect(await ids(await alice.request('GET', '/article?filter[tag.name]=secret'))).toEqual([article])
    expect(await ids(await alice.request('GET', '/article?filter[tag.name][starts]=op'))).toEqual([article])
    expect(await ids(await alice.request('GET', '/article?filter[tag.name]=none'))).toEqual([])
  })

  test('works through a to-one relationship and a two-step path', async () => {
    const { alice, secret, open, article } = await tagged()
    const plainJoin =
      await createAs(alice, 'tag', { name: 'other', kind: 'topic' })
        .then(other => createAs(
          alice, 'article_tag', {}
          , { article: toOne('article', article), tag: toOne('tag', other) }))

    // Tagging the article made one join row per tag
    expect(await ids(await alice.request('GET', '/article_tag?filter[article.heading]=Tagged')))
      .toHaveLength(3)
    expect(await ids(await alice.request('GET', '/article_tag?filter[tag.name]=other')))
      .toEqual([plainJoin])
    expect(await ids(await alice.request('GET', '/article_tag?filter[article.tag.name]=open')))
      .toHaveLength(3)
    expect(secret).not.toBe(open)
    expect(await ids(await alice.request('GET', '/article_tag?filter[article.heading]=Plain')))
      .toEqual([])
  })

  test('combines with filters on the resource itself', async () => {
    const { alice, article } = await tagged()
    expect(await ids(await alice.request('GET', '/article?filter[tag.name]=open&filter[heading]=Tagged')))
      .toEqual([article])
    expect(await ids(await alice.request('GET', '/article?filter[tag.name]=open&filter[heading]=Plain')))
      .toEqual([])
  })

  test('a related row the viewer cannot read never matches', async () => {
    const { bob, article } = await tagged()
    // Bob can read the article and the public tag, but not the private one
    expect(await ids(await bob.request('GET', '/article?filter[tag.name]=open'))).toEqual([article])
    expect(await ids(await bob.request('GET', '/article?filter[tag.name]=secret'))).toEqual([])
  })

  test('unknown relationships and fields are 400s naming the parameter', async () => {
    const { alice } = await tagged()
    for (const key of ['filter[nope.name]', 'filter[tag.nope]', 'filter[tag.name.x]']) {
      const response = await alice.request('GET', `/article?${key}=x`)
      const document = await response.json() as Document
      expect(response.status).toBe(400)
      expect(document.errors![0]!.source!.parameter).toBe(key)
    }
  })

  test('a related value of the wrong type is a 400', async () => {
    const { alice } = await tagged()
    const response = await alice.request('GET', '/article_tag?filter[article.updated_at][gt]=soon')
    expect(response.status).toBe(400)
  })
})

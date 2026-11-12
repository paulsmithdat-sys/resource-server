import { describe, expect, test } from 'bun:test'
import { createAs, createArticleAs, createTagAs, toOne } from './helpers/session.ts'
import { twoUsers } from './helpers/two-users.ts'

type Resource =
  { type: string
  , id: string
  , relationships?: Record<string, { data: unknown }>
  }

type Document =
  { data: Resource | Resource[]
  , included?: Resource[]
  , errors?: { status: string, source?: { parameter?: string } }[]
  }

const keys = (resources: Resource[] = []) => resources.map(x => `${x.type}:${x.id}`).sort()

/** An article with one tag, joined by a row the author makes public. */
const joined =
  async () => {
    const world = await twoUsers()
    const tag = await createTagAs(world.alice, 'topic')
    const article = await createArticleAs(world.alice, 'Private article')
    const join =
      await createAs(
        world.alice, 'article_tag', { visibility: 'public' }
        , { article: toOne('article', article), tag: toOne('tag', tag) })
    return { ...world, tag, article, join }
  }

describe('nested include paths', () => {
  test('include=article.tag returns each step with its linkage', async () => {
    const { alice, tag, article, join } = await joined()
    const document = await (await alice.request('GET', `/article_tag/${join}?include=article.tag`)).json() as Document

    expect(keys(document.included)).toEqual([`article:${article}`, `tag:${tag}`].sort())
    const included = document.included!.find(x => x.type === 'article')!
    expect(included.relationships!.tag!.data).toEqual([{ type: 'tag', id: tag }])
    expect((document.data as Resource).relationships!.article!.data).toEqual({ type: 'article', id: article })
  })

  test('a path also includes its intermediate resources, and repeats are merged', async () => {
    const { alice, join } = await joined()
    const both = await (await alice.request('GET', `/article_tag/${join}?include=article,article.tag,tag`)).json() as Document
    const nested = await (await alice.request('GET', `/article_tag/${join}?include=article.tag,tag`)).json() as Document

    expect(keys(both.included)).toEqual(keys(nested.included))
    expect(keys(both.included)).toHaveLength(2)
  })

  test('nested paths work on collections', async () => {
    const { alice, tag, article } = await joined()
    const document = await (await alice.request('GET', '/article_tag?include=article.tag')).json() as Document
    expect(keys(document.included)).toEqual([`article:${article}`, `tag:${tag}`].sort())
  })

  test('a viewer never gets a nested row they may not read', async () => {
    const { bob, article, tag, join } = await joined()
    const document = await (await bob.request('GET', `/article_tag/${join}?include=article.tag`)).json() as Document

    // Bob may read the public join row, but not the private article behind it
    expect((document.data as Resource).id).toBe(join)
    const text = JSON.stringify(document)
    expect(text).not.toContain(article)
    expect(text).not.toContain('Private article')
    expect(keys(document.included)).not.toContain(`tag:${tag}`)
  })

  test('a readable intermediate row does not expose an unreadable row behind it', async () => {
    const { alice, bob, tag } = await joined()
    const open = await createAs(alice, 'article', { heading: 'Public article', visibility: 'public' })
    const join =
      await createAs(
        alice, 'article_tag', { visibility: 'public' }
        , { article: toOne('article', open), tag: toOne('tag', tag) })

    const document = await (await bob.request('GET', `/article_tag/${join}?include=article.tag`)).json() as Document

    // Bob reads the public article, but the private tag linked to it stays hidden
    expect(keys(document.included)).toEqual([`article:${open}`])
    expect(JSON.stringify(document)).not.toContain(tag)
  })

  test('an unknown step is a 400 that names the include parameter', async () => {
    const { alice, join } = await joined()
    const response = await alice.request('GET', `/article_tag/${join}?include=article.nope`)
    const document = await response.json() as Document

    expect(response.status).toBe(400)
    expect(document.errors![0]!.source!.parameter).toBe('include')
  })

  test('a path deeper than three steps is a 400', async () => {
    const { alice, join } = await joined()
    const response = await alice.request('GET', `/article_tag/${join}?include=article.tag.x.y`)
    expect(response.status).toBe(400)
  })
})

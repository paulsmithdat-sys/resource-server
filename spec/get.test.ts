import { describe, expect, test } from 'bun:test'
import { articleSeed, tagSeed } from '../src/seed/index.ts'
import
  { createTestServer
  , JSON_API
  , seedDatabase
  } from './helpers/test-server.ts'

describe('GET', () => {
  test('returns seeded collections from the generated view', async () => {
    const { app } = await createTestServer()
    await seedDatabase(app)

    const response = await app.request('/tag')
    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toBe(JSON_API)

    const document = await response.json() as any
    expect(document.data).toHaveLength(tagSeed.length)
    expect(document.data.map((x: any) => x.id)).toEqual(
      tagSeed.map(x => x.id))

    const sql = document.data.find((x: any) => x.id === tagSeed[0]!.id)
    expect(sql.attributes).toMatchObject(
      { name: tagSeed[0]!.attributes.name
      , kind: tagSeed[0]!.attributes.kind
      })
    expect(document.meta.page).toEqual(
      { number: 1, size: 20, total: tagSeed.length, pages: 1 })
  })

  test('returns a seeded article with included tags', async () => {
    const { app } = await createTestServer()
    await seedDatabase(app)

    const seed = articleSeed[0]!
    const response =
      await app.request(`/article/${seed.id}?include=tag`)

    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toBe(JSON_API)

    const document = await response.json() as any
    expect(document.data.id).toBe(seed.id)
    expect(document.data.attributes).toMatchObject(seed.attributes)
    expect(document.data.relationships.tag.data).toEqual(
      seed.relationships.tag.data)
    expect(document.included.map((x: any) => x.id).sort()).toEqual(
      seed.relationships.tag.data.map(x => x.id))
  })

  test('filters and sorts seeded data', async () => {
    const { app } = await createTestServer()
    await seedDatabase(app)

    const response =
      await app.request('/tag?filter[kind]=topic&sort=-name')

    const document = await response.json() as any
    expect(document.data.map((x: any) => x.attributes.name)).toEqual(
      ['sql', 'database'])
  })
})

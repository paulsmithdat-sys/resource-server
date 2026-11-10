import { describe, expect, test } from 'bun:test'
import { articleSeed, tagSeed } from '../src/seed/index.ts'
import
  { createTestServer
  , seedDatabase
  } from './helpers/test-server.ts'

describe('DELETE', () => {
  test('deletes a seeded article and its join rows', async () => {
    const { app } = await createTestServer()
    await seedDatabase(app)

    const seed = articleSeed[0]!
    const response = await app.request(`/article/${seed.id}`, { method: 'DELETE' })

    expect(response.status).toBe(204)

    const missing = await app.request(`/article/${seed.id}`)
    expect(missing.status).toBe(404)

    const tags = await app.request('/tag')
    const document = await tags.json() as any
    expect(document.data).toHaveLength(tagSeed.length)
  })

  test('deletes a seeded tag after its articles are removed', async () => {
    const { app } = await createTestServer()
    await seedDatabase(app)

    for (const article of articleSeed)
      expect(
        (await app.request(`/article/${article.id}`, { method: 'DELETE' })).status
      ).toBe(204)

    const seed = tagSeed[0]!
    expect(
      (await app.request(`/tag/${seed.id}`, { method: 'DELETE' })).status
    ).toBe(204)

    expect((await app.request(`/tag/${seed.id}`)).status).toBe(404)
    const tags = await app.request('/tag')
    const document = await tags.json() as any
    expect(document.data).toHaveLength(tagSeed.length - 1)
  })

  test('returns 404 for a missing seeded resource', async () => {
    const { app } = await createTestServer()
    await seedDatabase(app)

    const response =
      await app.request(
        '/tag/01940000-0000-7000-8000-00000000ffff'
        , { method: 'DELETE' })

    expect(response.status).toBe(404)
  })
})

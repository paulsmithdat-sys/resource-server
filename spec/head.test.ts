import { describe, expect, test } from 'bun:test'
import { articleSeed } from '../src/seed/index.ts'
import
  { createTestServer
  , JSON_API
  , seedDatabase
  } from './helpers/test-server.ts'

describe('HEAD', () => {
  test('returns collection headers without a body', async () => {
    const { app } = await createTestServer()
    await seedDatabase(app)

    const response = await app.request('/tag', { method: 'HEAD' })

    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toBe(JSON_API)
    expect(await response.text()).toBe('')
  })

  test('returns single-resource headers without a body', async () => {
    const { app } = await createTestServer()
    await seedDatabase(app)

    const seed = articleSeed[0]!
    const response =
      await app.request(`/article/${seed.id}`, { method: 'HEAD' })

    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toBe(JSON_API)
    expect(await response.text()).toBe('')
  })

  test('returns error headers without a body', async () => {
    const { app } = await createTestServer()
    await seedDatabase(app)

    const response =
      await app.request(
        '/article/01940000-0000-7000-8000-00000000ffff'
        , { method: 'HEAD' })

    expect(response.status).toBe(404)
    expect(response.headers.get('content-type')).toBe(JSON_API)
    expect(await response.text()).toBe('')
  })
})

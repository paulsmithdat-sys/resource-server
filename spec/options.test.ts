import { describe, expect, test } from 'bun:test'
import { articleSeed } from '../src/seed/index.ts'
import { createTestServer, seedDatabase } from './helpers/test-server.ts'

const methods =
  (response: Response) =>
    (response.headers.get('allow') ?? '')
      .split(',')
      .map(x => x.trim())

describe('OPTIONS', () => {
  test('advertises collection methods', async () => {
    const { app } = await createTestServer()
    await seedDatabase(app)

    const response = await app.request('/tag', { method: 'OPTIONS' })

    expect(response.status).toBe(204)
    expect(methods(response)).toEqual(
      ['GET', 'HEAD', 'POST', 'OPTIONS'])
    expect(await response.text()).toBe('')
  })

  test('advertises single-resource methods', async () => {
    const { app } = await createTestServer()
    await seedDatabase(app)

    const seed = articleSeed[0]!
    const response =
      await app.request(`/article/${seed.id}`, { method: 'OPTIONS' })

    expect(response.status).toBe(204)
    expect(methods(response)).toEqual(
      ['GET', 'HEAD', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'])
  })

  test('advertises catalog methods', async () => {
    const { app } = await createTestServer()

    const response = await app.request('/', { method: 'OPTIONS' })

    expect(response.status).toBe(204)
    expect(methods(response)).toEqual(['GET', 'HEAD', 'OPTIONS'])
  })
})

import { describe, expect, test } from 'bun:test'
import { articleSeed, tagSeed } from '../src/seed/index.ts'
import
  { createTestServer
  , JSON_API
  , postDocument
  } from './helpers/test-server.ts'

describe('POST', () => {
  test('creates a seeded tag document', async () => {
    const { app } = await createTestServer()
    const seed = tagSeed[0]!

    const response = await postDocument(app, seed)

    expect(response.status).toBe(201)
    expect(response.headers.get('content-type')).toBe(JSON_API)
    expect(response.headers.get('location')).toBe(`/tag/${seed.id}`)

    const document = await response.json() as any
    expect(document.data).toMatchObject(
      { type: 'tag'
      , id: seed.id
      , attributes:
        { name: seed.attributes.name
        , kind: seed.attributes.kind
        }
      })
  })

  test('creates a seeded article and its join-table relationships', async () => {
    const { app } = await createTestServer()
    for (const tag of tagSeed)
      expect((await postDocument(app, tag)).status).toBe(201)

    const seed = articleSeed[0]!
    const response = await postDocument(app, seed)

    expect(response.status).toBe(201)
    expect(response.headers.get('location')).toBe(`/article/${seed.id}`)

    const document = await response.json() as any
    expect(document.data).toMatchObject(
      { type: 'article'
      , id: seed.id
      , attributes: seed.attributes
      })
    expect(document.data.relationships.tag.data).toEqual(
      seed.relationships.tag.data)

    const read = await app.request(`/article/${seed.id}?include=tag`)
    const readDocument = await read.json() as any
    expect(readDocument.included).toHaveLength(
      seed.relationships.tag.data.length)
  })

  test('rejects a document with the wrong resource type', async () => {
    const { app } = await createTestServer()
    const seed = tagSeed[0]!

    const response =
      await app.request(
        '/article'
        , { method: 'POST'
          , headers: { 'content-type': JSON_API }
          , body: JSON.stringify(
              { data: { ...seed, type: 'tag' } })
          })

    expect(response.status).toBe(400)
    const document = await response.json() as any
    expect(document.errors[0].source.parameter).toBe('data.type')
  })
})

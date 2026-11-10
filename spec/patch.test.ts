import { describe, expect, test } from 'bun:test'
import { articleSeed, tagSeed } from '../src/seed/index.ts'
import
  { createTestServer
  , JSON_API
  , seedDatabase
  } from './helpers/test-server.ts'

describe('PATCH', () => {
  test('updates only the supplied seeded attributes', async () => {
    const { app } = await createTestServer()
    await seedDatabase(app)

    const seed = articleSeed[0]!
    const response =
      await app.request(
        `/article/${seed.id}`
        , { method: 'PATCH'
          , headers: { 'content-type': JSON_API }
          , body: JSON.stringify(
              { data:
                { type: 'article'
                , id: seed.id
                , attributes: { heading: 'A patched heading' }
                }
              })
          })

    expect(response.status).toBe(200)
    const document = await response.json() as any
    expect(document.data.attributes).toMatchObject(
      { heading: 'A patched heading'
      , subheading: seed.attributes.subheading
      , content: seed.attributes.content
      })
    expect(document.data.relationships.tag.data).toEqual(
      seed.relationships.tag.data)
  })

  test('replaces only the supplied seeded relationship', async () => {
    const { app } = await createTestServer()
    await seedDatabase(app)

    const seed = articleSeed[0]!
    const response =
      await app.request(
        `/article/${seed.id}`
        , { method: 'PATCH'
          , headers: { 'content-type': JSON_API }
          , body: JSON.stringify(
              { data:
                { type: 'article'
                , id: seed.id
                , relationships:
                  { tag:
                    { data:
                      [ { type: 'tag'
                        , id: tagSeed[2]!.id
                        }
                      ]
                    }
                  }
                }
              })
          })

    expect(response.status).toBe(200)
    const document = await response.json() as any
    expect(document.data.attributes.heading).toBe(seed.attributes.heading)
    expect(document.data.relationships.tag.data).toEqual(
      [ { type: 'tag'
        , id: tagSeed[2]!.id
        }
      ])
  })

  test('validates seeded attribute values', async () => {
    const { app } = await createTestServer()
    await seedDatabase(app)

    const seed = articleSeed[0]!
    const response =
      await app.request(
        `/article/${seed.id}`
        , { method: 'PATCH'
          , headers: { 'content-type': JSON_API }
          , body: JSON.stringify(
              { data:
                { type: 'article'
                , id: seed.id
                , attributes: { heading: 'x' }
                }
              })
          })

    expect(response.status).toBe(400)
    const document = await response.json() as any
    expect(document.errors[0].source.parameter).toBe('data.attributes.heading')
  })
})

import { describe, expect, test } from 'bun:test'
import { articleSeed, tagSeed } from '../src/seed/index.ts'
import
  { createTestServer
  , JSON_API
  , seedDatabase
  } from './helpers/test-server.ts'

describe('PUT', () => {
  test('replaces seeded attributes and relationships', async () => {
    const { app } = await createTestServer()
    await seedDatabase(app)

    const seed = articleSeed[0]!
    const replacement =
      { type: 'article'
      , id: seed.id
      , attributes:
        { heading: 'A replacement heading'
        , subheading: 'A replacement subheading'
        , content: 'Replacement content.'
        }
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

    const response =
      await app.request(
        `/article/${seed.id}`
        , { method: 'PUT'
          , headers: { 'content-type': JSON_API }
          , body: JSON.stringify({ data: replacement })
          })

    expect(response.status).toBe(200)
    const document = await response.json() as any
    expect(document.data.attributes).toMatchObject(replacement.attributes)
    expect(document.data.relationships.tag.data).toEqual(
      replacement.relationships.tag.data)

    const read = await app.request(`/article/${seed.id}?include=tag`)
    const readDocument = await read.json() as any
    expect(readDocument.data.attributes.heading).toBe(
      replacement.attributes.heading)
    expect(readDocument.included.map((x: any) => x.id)).toEqual(
      replacement.relationships.tag.data.map(x => x.id))
  })

  test('replaces omitted optional attributes and relationships', async () => {
    const { app } = await createTestServer()
    await seedDatabase(app)

    const seed = articleSeed[0]!
    const response =
      await app.request(
        `/article/${seed.id}`
        , { method: 'PUT'
          , headers: { 'content-type': JSON_API }
          , body: JSON.stringify(
              { data:
                { type: 'article'
                , id: seed.id
                , attributes: { heading: 'Only a heading remains' }
                }
              })
          })

    expect(response.status).toBe(200)
    const document = await response.json() as any
    expect(document.data.attributes).toMatchObject(
      { heading: 'Only a heading remains'
      , subheading: null
      , content: null
      })
    expect(document.data.relationships.tag.data).toEqual([])
  })

  test('returns 404 for a missing seeded resource', async () => {
    const { app } = await createTestServer()
    await seedDatabase(app)

    const missingId = '01940000-0000-7000-8000-00000000ffff'
    const response =
      await app.request(
        `/article/${missingId}`
        , { method: 'PUT'
          , headers: { 'content-type': JSON_API }
          , body: JSON.stringify(
              { data:
                { type: 'article'
                , id: missingId
                , attributes: { heading: 'Missing' }
                }
              })
          })

    expect(response.status).toBe(404)
  })
})

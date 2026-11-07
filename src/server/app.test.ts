import { describe, expect, test } from 'bun:test'
import { buildSchema } from '../db/build-schema.ts'
import
  { pascalCase
  , snakeCase
  , type JSONSchema
  , type LoadedSchema
  } from '../db/schema-types.ts'
import { createApp } from './app.ts'
import type { Row, RowDatabase } from './database.ts'

const loadedSchema =
  (schema: JSONSchema): LoadedSchema => (
    { schema
    , source: `/test/${schema.title}.ts`
    , importPath: `src/schema/${snakeCase(schema.title)}.ts`
    , exportName: `${pascalCase(schema.title)}Schema`
    })

const built = buildSchema(
  [ loadedSchema(
      { title: 'Article'
      , type: 'object'
      , properties:
        { heading: { type: 'string' }
        , subheading: { type: 'string' }
        , content: { type: 'string' }
        }
      , 'x-relations':
        { tag: { table: 'tag', column: 'id', cardinality: 'many' } }
      })
  , loadedSchema(
      { title: 'Tag'
      , type: 'object'
      , properties:
        { name: { type: 'string' }
        , kind: { type: 'string' }
        }
      })
  ])

const tagRow: Row =
  { id: '01900000-0000-7000-8000-000000000002'
  , updated_at: 1
  , name: 'sql'
  , kind: 'topic'
  }

const articleRow: Row =
  { id: '01900000-0000-7000-8000-000000000001'
  , updated_at: 1
  , heading: 'Hello'
  , subheading: null
  , content: null
  , tag: JSON.stringify([tagRow])
  }

const createDatabase =
  (rows: Row[]) => {
    const calls: { sql: string; params: unknown[] }[] = []

    const db: RowDatabase =
      { all: async (sql, params = []) => {
          calls.push({ sql, params })
          return rows
        }
      , get: async (sql, params = []) => {
          calls.push({ sql, params })
          if (sql.includes('COUNT(')) return { count: rows.length }
          return rows.find(row => row.id === params[0])
        }
      }

    return { db, calls }
  }

describe('JSON:API application', () => {
  test('serves a collection with attributes, relationships, and pagination meta', async () => {
    const { db } = createDatabase([articleRow])
    const app = createApp({ built, db })

    const response = await app.request('/article')
    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toBe('application/vnd.api+json')

    const document = await response.json() as any
    expect(document.data).toHaveLength(1)
    expect(document.data[0].type).toBe('article')
    expect(document.data[0].id).toBe(articleRow.id)
    expect(document.data[0].attributes).toEqual(
      { updated_at: 1
      , heading: 'Hello'
      , subheading: null
      , content: null
      })
    expect(document.data[0].relationships.tag.data).toEqual(
      [{ type: 'tag', id: tagRow.id }])
    expect(document.meta.page).toEqual(
      { number: 1, size: 20, total: 1, pages: 1 })
  })

  test('serves a single resource', async () => {
    const { db } = createDatabase([articleRow])
    const app = createApp({ built, db })

    const response = await app.request(`/article/${articleRow.id}`)
    expect(response.status).toBe(200)

    const document = await response.json() as any
    expect(document.data.id).toBe(articleRow.id)
    expect(document.data.attributes.heading).toBe('Hello')
  })

  test('includes related resources', async () => {
    const { db } = createDatabase([articleRow])
    const app = createApp({ built, db })

    const response = await app.request('/article?include=tag')
    const document = await response.json() as any

    expect(document.included).toHaveLength(1)
    expect(document.included[0]).toMatchObject(
      { type: 'tag'
      , id: tagRow.id
      , attributes: { updated_at: 1, name: 'sql', kind: 'topic' }
      })
  })

  test('honours sparse fieldsets', async () => {
    const { db } = createDatabase([articleRow])
    const app = createApp({ built, db })

    const response =
      await app.request('/article?fields[article]=heading&fields[tag]=name&include=tag')
    const document = await response.json() as any

    expect(document.data[0].attributes).toEqual({ heading: 'Hello' })
    expect(document.data[0].relationships.tag.data).toEqual(
      [{ type: 'tag', id: tagRow.id }])
    expect(document.included[0].attributes).toEqual({ name: 'sql' })
  })

  test('applies filters, sorting, and pagination to SQL', async () => {
    const { db, calls } = createDatabase([articleRow])
    const app = createApp({ built, db })

    await app.request(
      '/article?filter[heading]=Hello&sort=-heading&page[number]=2&page[size]=5')

    const countCall = calls.find(x => x.sql.includes('COUNT('))!
    expect(countCall.params).toEqual(['Hello'])

    const listCall = calls.find(x => x.sql.startsWith('SELECT *'))!
    expect(listCall.sql).toContain('WHERE `heading` = ?')
    expect(listCall.sql).toContain('ORDER BY `heading` DESC')
    expect(listCall.params).toEqual(['Hello', 5, 5])
  })

  test('returns JSON:API errors for invalid requests', async () => {
    const { db } = createDatabase([articleRow])
    const app = createApp({ built, db })

    const unknown = await app.request('/missing')
    expect(unknown.status).toBe(404)
    const unknownDocument = await unknown.json() as any
    expect(unknownDocument.errors[0].status).toBe('404')

    const missing = await app.request('/article/missing')
    expect(missing.status).toBe(404)

    const sort = await app.request('/article?sort=tag')
    expect(sort.status).toBe(400)
    const sortDocument = await sort.json() as any
    expect(sortDocument.errors[0].source.parameter).toBe('sort')

    const include = await app.request('/article?include=user')
    expect(include.status).toBe(400)

    const page = await app.request('/article?page[size]=0')
    expect(page.status).toBe(400)
  })

  test('exposes a resource catalog', async () => {
    const { db } = createDatabase([])
    const app = createApp({ built, db })

    const response = await app.request('/')
    const document = await response.json() as any

    expect(document.meta.resources.map((x: any) => x.type)).toContain('article')
    expect(
      document.meta.resources
        .find((x: any) => x.type === 'article')
        .relationships).toContain('tag')
  })
})

import { describe, expect, test } from 'bun:test'
import { buildSchema } from '../../../src/db/build-schema.ts'
import
  { snakeCase
  , type JSONSchema
  , type LoadedSchema
  } from '../../../src/db/schema-types.ts'
import { createApp } from '../../../src/server/app/index.ts'
import type { Row, RowDatabase } from '../../../src/server/database.ts'
import { buildRegistry } from '../../../src/server/registry.ts'
import { listRows } from '../../../src/server/read.ts'
import type { ListQuery } from '../../../src/server/query.ts'

const loadedSchema =
  (schema: JSONSchema): LoadedSchema => (
    { schema
    , source: `/test/${schema.title}.ts`
    , importPath: `src/schema/${snakeCase(schema.title)}.yaml`
    })

const articleSchema: JSONSchema =
  { title: 'Article'
  , type: 'object'
  , properties:
    { heading: { type: 'string' }
    , published: { type: 'boolean' }
    }
  , 'x-relations':
    { author: { table: 'author', column: 'id', cardinality: 'one' }
    , tag: { table: 'tag', column: 'id', cardinality: 'many' }
    }
  }

const authorSchema: JSONSchema =
  { title: 'Author'
  , type: 'object'
  , properties: { name: { type: 'string' } }
  }

const tagSchema: JSONSchema =
  { title: 'Tag'
  , type: 'object'
  , properties: { name: { type: 'string' } }
  }

/** The scope columns every authored view must project from its base row. */
const scopeProperties: JSONSchema['properties'] =
  { id:
      { type: 'string', format: 'uuid', 'x-source': 'article.id' }
  , owner:
      { type: 'string', format: 'uuid', 'x-source': 'article.owner' }
  , visibility:
      { type: 'string', 'x-source': 'article.visibility' }
  }

const previewSchema: JSONSchema =
  { title: 'Article Preview'
  , type: 'object'
  , 'x-view': true
  , 'x-source': 'article'
  , properties:
    { ...scopeProperties
    , heading: { type: 'string', 'x-source': 'article.heading' }
    , author:
        { type: 'object', 'x-source': 'article.author' }
    , tags:
        { type: 'array', 'x-source': 'article.tag' }
    }
  }

const build =
  (...schemas: JSONSchema[]) =>
    buildSchema(
      [articleSchema, authorSchema, tagSchema, ...schemas].map(loadedSchema))

describe('authored views', () => {
  test('builds a read-only resource over its base table', () => {
    const built = build(previewSchema)

    expect(built.authoredViews.article_preview).toBeDefined()
    const view = built.authoredViews.article_preview!
    expect(view.sourceTable).toBe('article')
    expect(view.access.create).toBe('none')
    expect(view.columns.map(x => x.columnName))
      .toEqual(['id', 'owner', 'visibility', 'heading'])
    expect(Object.keys(view.relations)).toEqual(['author', 'tags'])
  })

  test('projects columns and embeds relation properties', () => {
    const built = build(previewSchema)
    const sql = built.views.article_preview!.sql

    expect(sql).toContain('CREATE VIEW `article_preview` AS')
    expect(sql).toContain('FROM `article` AS `t`')
    expect(sql).toContain('AS `heading`')
    expect(sql).toContain('AS `author`')
    expect(sql).toContain('(SELECT json_object(')
    expect(sql).toContain('FROM `author` AS `r0`')
    expect(sql).toContain('AS `tags`')
    expect(sql).toContain('JOIN `article_tag` AS `j0`')
  })

  test('keeps generated table views alongside authored ones', () => {
    const built = build(previewSchema)

    expect(Object.keys(built.views).sort()).toEqual(
      [ 'article_preview'
      , 'article_tag_view'
      , 'article_view'
      , 'author_view'
      , 'tag_view'
      ])
  })

  test('registers the view as a read-only resource', () => {
    const built = build(previewSchema)
    const registry = buildRegistry(built)
    const preview = registry.get('article_preview')!

    expect(preview.readOnly).toBe(true)
    expect(preview.view).toBe('article_preview')
    expect(preview.table).toBe('article_preview')
    expect(preview.attributes).toEqual(['owner', 'visibility', 'heading'])
    expect(preview.relationships).toHaveProperty('author')
    expect(preview.relationships).toHaveProperty('tags')

    expect(registry.get('article')!.readOnly).toBe(false)
  })

  test('reads rows straight from the view', async () => {
    const built = build(previewSchema)
    const registry = buildRegistry(built)
    const resource = registry.get('article_preview')!
    const calls: string[] = []
    const db: RowDatabase =
      { all: async sql => {
          calls.push(sql)
          return []
        }
      , get: async sql => {
          calls.push(sql)
          return { count: 0 }
        }
      , run: async () => ({ changes: 0, lastInsertRowid: 0 })
      }
    const query: ListQuery =
      { pageNumber: 1
      , pageSize: 20
      , sort: [{ field: 'heading', direction: 'desc' }]
      , filters:
          [ { key: 'filter[heading]'
            , path: []
            , field: 'heading'
            , operator: 'eq'
            , value: 'Hello'
            }
          ]
      , fields: new Map()
      , include: []
      , includeTree: new Map()
      }
    const tables =
      new Map(built.orderedTables.map(x => [x.tableName, x]))
    const scopeFor =
      () => ({ sql: '', params: [] })

    await listRows(db, tables, resource, query, [], scopeFor)

    expect(calls[0]).toContain(
      'SELECT COUNT(*) AS count FROM (SELECT * FROM `article_preview`)')
    expect(calls[1]).toContain(
      'SELECT * FROM (SELECT * FROM `article_preview`)')
    expect(calls[1]).toContain('WHERE (`article_preview`.`heading` = ?)')
    expect(calls[1]).toContain('ORDER BY `article_preview`.`heading` DESC')
  })

  test('rejects writes and advertises read-only methods', async () => {
    const built = build(previewSchema)
    const rows: Row[] = []
    const db: RowDatabase =
      { all: async () => rows
      , get: async () => undefined
      , run: async () => ({ changes: 0, lastInsertRowid: 0 })
      }
    const app = createApp({ built, db })
    const id = '01900000-0000-7000-8000-000000000001'

    const create =
      await app.request(
        '/article_preview', { method: 'POST', body: '{}' })
    expect(create.status).toBe(405)

    const update =
      await app.request(
        `/article_preview/${id}`, { method: 'PATCH', body: '{}' })
    expect(update.status).toBe(405)

    const remove =
      await app.request(`/article_preview/${id}`, { method: 'DELETE' })
    expect(remove.status).toBe(405)

    const link =
      await app.request(
        `/article_preview/${id}/relationships/tags`
        , { method: 'POST', body: '{}' })
    expect(link.status).toBe(405)

    const options = await app.request('/article_preview', { method: 'OPTIONS' })
    expect(options.headers.get('allow')).toBe('GET, HEAD, OPTIONS')

    const itemOptions =
      await app.request(`/article_preview/${id}`, { method: 'OPTIONS' })
    expect(itemOptions.headers.get('allow')).toBe('GET, HEAD, OPTIONS')

    const tableOptions = await app.request('/article', { method: 'OPTIONS' })
    expect(tableOptions.headers.get('allow'))
      .toBe('GET, HEAD, POST, OPTIONS')
  })
})

describe('authored view validation', () => {
  const withProperties =
    (...properties: JSONSchema['properties'][]): JSONSchema => (
      { ...previewSchema
      , properties: Object.assign({}, ...properties)
      })

  test('rejects an unknown base table', () => {
    expect(
      () =>
        build(
          { ...previewSchema
          , 'x-source': 'missing'
          }))
      .toThrow('Article Preview: x-source table "missing" does not exist')
  })

  test('requires id, owner and visibility', () => {
    expect(
      () =>
        build(
          withProperties(
            { heading: { type: 'string', 'x-source': 'article.heading' } })))
      .toThrow('views must expose "id"')
  })

  test('requires id and owner to be uuids from the base row', () => {
    expect(
      () =>
        build(
          withProperties(
            scopeProperties
            , { id: { type: 'string', 'x-source': 'article.id' } })))
      .toThrow('"id" must use format "uuid"')
  })

  test('rejects a scope column from another row', () => {
    expect(
      () =>
        build(
          withProperties(
            scopeProperties
            , { visibility:
                { type: 'string', 'x-source': 'article.heading' } })))
      .toThrow('"visibility" must source "article.visibility"')
  })

  test('rejects shareable and inherited access', () => {
    expect(
      () =>
        build(
          { ...previewSchema, 'x-access': { shareable: true } }))
      .toThrow('views cannot be shareable')
    expect(
      () =>
        build(
          { ...previewSchema, 'x-access': { inherit: 'author' } }))
      .toThrow('views cannot inherit access')
  })

  test('rejects a writable create level', () => {
    expect(
      () =>
        build(
          { ...previewSchema, 'x-access': { create: 'session' } }))
      .toThrow('views are read-only; x-access create must be "none"')
  })

  test('rejects relations declared the table way', () => {
    expect(
      () =>
        build(
          { ...previewSchema
          , 'x-relations':
              { author: { table: 'author', column: 'id', cardinality: 'one' } }
          }))
      .toThrow('views declare relations as properties with x-source')
  })

  test('rejects a name already used by a table or its view', () => {
    expect(() => build({ ...previewSchema, title: 'Article' }))
      .toThrow('view name "article" is already in use')
    expect(() => build({ ...previewSchema, title: 'Article View' }))
      .toThrow('view name "article_view" is already in use')
  })

  test('rejects a view sourcing another view', () => {
    expect(
      () =>
        build(
          { ...previewSchema
          , title: 'Other'
          , 'x-source': 'article_preview'
          }))
      .toThrow('x-source table "article_preview" does not exist')
  })

  test('rejects hidden columns and relations', () => {
    const hiddenArticle: JSONSchema =
      { ...articleSchema
      , properties:
          { ...articleSchema.properties
          , heading:
              { type: 'string', 'x-exposed': false }
          }
      }

    expect(
      () =>
        buildSchema(
          [hiddenArticle, authorSchema, tagSchema, previewSchema]
            .map(loadedSchema)))
      .toThrow('names hidden column "article.heading"')

    const hiddenRelationArticle: JSONSchema =
      { ...articleSchema
      , 'x-relations':
          { ...articleSchema['x-relations']
          , author:
              { ...articleSchema['x-relations']!.author!
              , 'x-exposed': false
              }
          }
      }

    expect(
      () =>
        buildSchema(
          [hiddenRelationArticle, authorSchema, tagSchema, previewSchema]
            .map(loadedSchema)))
      .toThrow('names hidden relation "author"')
  })

  test('rejects a relation with the wrong cardinality type', () => {
    expect(
      () =>
        build(
          withProperties(
            scopeProperties
            , { tags: { type: 'object', 'x-source': 'article.tag' } })))
      .toThrow('relation property "tags" is to-many; its type must be array')
  })

  test('rejects x-view on a table', () => {
    expect(
      () =>
        buildSchema(
          [loadedSchema({ title: 'Table', type: 'object', 'x-view': 'yes' })]))
      .toThrow('Table: x-view must be a boolean')
  })
})

import { describe, expect, test } from 'bun:test'
import { getTableConfig } from 'drizzle-orm/sqlite-core'
import { buildSchema } from './build-schema.ts'
import { buildOne, loadedSchema, userSchema } from './build-schema.helpers.ts'
import { type JSONSchema } from './schema-types.ts'

describe('buildSchema relations', () => {
  test('keeps relation metadata and validates its shape', () => {
    const built = buildSchema(
      [ loadedSchema(userSchema)
      , loadedSchema(
          { title: 'Widget'
          , type: 'object'
          , properties: {}
          , 'x-relations':
            { member:
              { table: 'user'
              , column: 'id'
              , cardinality: 'one'
              , foreignKey: 'member_id'
              , onDelete: 'restrict'
              }
            }
          })
      ])

    expect(built.tables.Widget!.relations.member).toEqual(
      { table: 'user'
      , column: 'id'
      , cardinality: 'one'
      , foreignKey: 'member_id'
      , onDelete: 'restrict'
      , exposed: true
      })
  })

  test('derives a foreign key column and index for one relations', () => {
    const built = buildSchema(
      [ loadedSchema(userSchema)
      , loadedSchema(
          { title: 'Widget'
          , type: 'object'
          , properties: {}
          , 'x-relations':
            { member:
              { table: 'user'
              , column: 'id'
              , cardinality: 'one'
              , onDelete: 'restrict'
              }
            }
          })
      ])

    const widget = built.tables.Widget!
    expect(widget.columns.map(x => x.columnName))
      .toEqual(['id', 'updated_at', 'owner', 'visibility', 'user_id'])
    expect(widget.foreignKeys).toEqual(
      [ { columns: ['user_id']
        , foreignTable: 'user'
        , foreignColumns: ['id']
        , onDelete: 'restrict'
        }
      , { columns: ['owner']
        , foreignTable: 'user'
        , foreignColumns: ['id']
        , onDelete: 'set null'
        }
      ])

    const config = getTableConfig(widget.drizzleSchema)
    expect(config.foreignKeys).toHaveLength(2)
    expect(config.indexes.map(x => (x.config.columns[0] as any).name))
      .toEqual(['user_id', 'owner'])
  })

  test('makes required one relation columns not null', () => {
    const built = buildSchema(
      [ loadedSchema(userSchema)
      , loadedSchema(
          { title: 'Widget'
          , type: 'object'
          , properties: {}
          , 'x-relations':
            { member:
              { table: 'user'
              , column: 'id'
              , cardinality: 'one'
              , required: true
              }
            }
          })
      ])

    const config = getTableConfig(built.tables.Widget!.drizzleSchema)
    const userId = config.columns.find(x => x.name === 'user_id')!
    expect(userId.notNull).toBe(true)
  })

  test('rejects invalid relations', () => {
    expect(() => buildOne(
      { title: 'Widget'
      , type: 'object'
      , properties: {}
      , 'x-relations':
        { owner: { table: 'user', cardinality: 'invalid' as 'one' } }
      })).toThrow('cardinality must be')

    expect(() => buildOne(
      { title: 'Widget'
      , type: 'object'
      , properties: {}
      , 'x-relations':
        { owner: { table: '', cardinality: 'one' } }
      })).toThrow('needs a table')

    expect(() => buildOne(
      { title: 'Widget'
      , type: 'object'
      , properties: {}
      , 'x-relations':
        { owner: { table: 'user', cardinality: 'one', foreignKey: 1 as unknown as string } }
      })).toThrow('foreignKey must be a string')
  })

  test('rejects relations to unknown tables and cyclic foreign keys', () => {
    expect(() => buildOne(
      { title: 'Widget'
      , type: 'object'
      , properties: {}
      , 'x-relations':
        { owner: { table: 'user', cardinality: 'one' } }
      })).toThrow('targets unknown table "user"')

    expect(() => buildSchema(
      [ loadedSchema(
          { title: 'A'
          , type: 'object'
          , properties: {}
          , 'x-relations':
            { b: { table: 'b', cardinality: 'one' } }
          })
      , loadedSchema(
          { title: 'B'
          , type: 'object'
          , properties: {}
          , 'x-relations':
            { a: { table: 'a', cardinality: 'one' } }
          })
      ])).toThrow('Cyclic foreign key dependency')
  })
})

describe('buildSchema derived relations', () => {
  const articleSchema: JSONSchema =
    { title: 'Article'
    , type: 'object'
    , properties: { heading: { type: 'string' } }
    , 'x-relations':
      { tag: { table: 'tag', column: 'id', cardinality: 'many' } }
    }

  const tagSchema: JSONSchema =
    { title: 'Tag'
    , type: 'object'
    , properties: { name: { type: 'string' } }
    }

  test('creates a derived join table for many-to-many relations', () => {
    const built = buildSchema(
      [loadedSchema(articleSchema), loadedSchema(tagSchema)])

    const join = built.tables.ArticleTag!
    expect(join.tableName).toBe('article_tag')
    expect(join.derived).toBe(true)
    expect(join.columns.map(x => x.columnName))
      .toEqual(['id', 'updated_at', 'owner', 'visibility', 'article_id', 'tag_id'])

    const config = getTableConfig(join.drizzleSchema)
    const articleId = config.columns.find(x => x.name === 'article_id')!
    const tagId = config.columns.find(x => x.name === 'tag_id')!
    expect(articleId.notNull).toBe(true)
    expect(tagId.notNull).toBe(true)
    expect(articleId.getSQLType()).toBe('blob')
    expect(tagId.getSQLType()).toBe('blob')
    expect(config.foreignKeys).toHaveLength(2)
    expect(config.uniqueConstraints).toHaveLength(1)
    expect(
      config.uniqueConstraints[0]!.columns.map(x => x.name).sort())
      .toEqual(['article_id', 'tag_id'])
  })

  test('deduplicates the two sides of a many-to-many relation', () => {
    const built = buildSchema(
      [ loadedSchema(articleSchema)
      , loadedSchema(
          { ...tagSchema
          , 'x-relations':
            { article:
              { table: 'article', column: 'id', cardinality: 'many' }
            }
          })
      ])

    expect(
      built.orderedTables.filter(x => x.derived).map(x => x.tableName))
      .toEqual(['article_tag'])
  })

  test('uses an explicit through table name', () => {
    const built = buildSchema(
      [ loadedSchema(
          { ...articleSchema
          , 'x-relations':
            { tag:
              { table: 'tag'
              , column: 'id'
              , cardinality: 'many'
              , through: 'article_tags'
              }
            }
          })
      , loadedSchema(tagSchema)
      ])

    expect(built.tables.ArticleTags).toBeDefined()
    expect(built.tables.ArticleTags!.tableName).toBe('article_tags')
    expect(built.tables.Article!.relations.tag!.through).toBe('article_tags')
  })

  test('detects inverse one-to-many relations instead of join tables', () => {
    const built = buildSchema(
      [ loadedSchema(
          { title: 'User'
          , type: 'object'
          , properties: {}
          , 'x-relations':
            { keys: { table: 'key', column: 'id', cardinality: 'many' } }
          })
      , loadedSchema(
          { title: 'Key'
          , type: 'object'
          , properties: {}
          , 'x-relations':
            { user: { table: 'user', column: 'id', cardinality: 'one' } }
          })
      ])

    expect(built.orderedTables.map(x => x.tableName)).toEqual(['key', 'user'])
    expect(built.tables.Key!.foreignKeys).toEqual(
      [ { columns: ['user_id']
        , foreignTable: 'user'
        , foreignColumns: ['id']
        }
      , { columns: ['owner']
        , foreignTable: 'user'
        , foreignColumns: ['id']
        , onDelete: 'set null'
        }
      ])
  })

  test('rejects conflicting join table names and self relations', () => {
    expect(() => buildSchema(
      [ loadedSchema(
          { ...articleSchema
          , 'x-relations':
            { tag:
              { table: 'tag'
              , column: 'id'
              , cardinality: 'many'
              , through: 'first'
              }
            }
          })
      , loadedSchema(
          { ...tagSchema
          , 'x-relations':
            { article:
              { table: 'article'
              , column: 'id'
              , cardinality: 'many'
              , through: 'second'
              }
            }
          })
      ])).toThrow('Conflicting join table names')

    const built = buildSchema(
      [ loadedSchema(
          { title: 'Node'
          , type: 'object'
          , properties: {}
          , 'x-relations':
            { links: { table: 'node', column: 'id', cardinality: 'many' } }
          })
      ])
    const join = built.orderedTables.find(x => x.tableName === 'node_links')!
    expect(join.columns.map(x => x.columnName)).toEqual(
      expect.arrayContaining(['node_id', 'related_node_id']))
    expect(built.orderedTables.find(x => x.tableName === 'node')!
      .relations.links!.through).toBe('node_links')
  })

  test('normalizes and validates unique constraints', () => {
    const built = buildSchema(
      [ loadedSchema(
          { title: 'Pair'
          , type: 'object'
          , properties:
            { left: { type: 'string' }
            , right: { type: 'string' }
            }
          , 'x-unique-constraints': [['left', 'right']]
          })
      ])

    const config = getTableConfig(built.tables.Pair!.drizzleSchema)
    expect(config.uniqueConstraints.map(x => x.columns.map(c => c.name)))
      .toEqual([['left', 'right']])

    expect(() => buildOne(
      { title: 'Pair'
      , type: 'object'
      , properties: { left: { type: 'string' } }
      , 'x-unique-constraints': [['left', 'missing']]
      })).toThrow('unknown column "missing"')
  })
})

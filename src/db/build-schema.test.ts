import { describe, expect, test } from 'bun:test'
import { getTableConfig } from 'drizzle-orm/sqlite-core'
import { buildSchema, createUpdatedTrigger } from './build-schema.ts'
import
  { pascalCase
  , snakeCase
  , type JSONSchema
  , type LoadedSchema
  } from './schema-types.ts'

const loadedSchema =
  (schema: JSONSchema): LoadedSchema => (
    { schema
    , source: `/test/${schema.title}.ts`
    , importPath: `src/schema/${snakeCase(schema.title)}.ts`
    , exportName: `${pascalCase(schema.title)}Schema`
    })

const buildOne =
  (schema: JSONSchema) => buildSchema([loadedSchema(schema)])

const userSchema: JSONSchema =
  { title: 'User'
  , type: 'object'
  , properties:
    { name: { type: 'string' } }
  }

const columnConfig =
  (schema: JSONSchema, tableName?: string) => {
    const built = buildOne(schema)
    const table = tableName
      ? built.tables[tableName]!
      : built.orderedTables[0]!
    return getTableConfig(table.drizzleSchema)
  }

describe('snakeCase and pascalCase', () => {
  test('convert titles to table and export names', () => {
    expect(snakeCase('Blog Post')).toBe('blog_post')
    expect(snakeCase('UserGroup')).toBe('user_group')
    expect(snakeCase('HTTPServer')).toBe('http_server')
    expect(pascalCase('blog post')).toBe('BlogPost')
    expect(pascalCase('user_group')).toBe('UserGroup')
  })
})

describe('buildSchema default columns', () => {
  test('injects id and updated_at for every table', () => {
    const config = columnConfig(
      { title: 'Widget', type: 'object', properties: {} })

    expect(config.name).toBe('widget')
    expect(config.columns.map(x => x.name)).toEqual(['id', 'updated_at'])

    const [id, updatedAt] = config.columns
    expect(id!.getSQLType()).toBe('blob')
    expect(id!.primary).toBe(true)
    expect(id!.notNull).toBe(true)
    expect(id!.hasDefault).toBe(true)

    expect(updatedAt!.getSQLType()).toBe('integer')
    expect(updatedAt!.notNull).toBe(true)
    expect(updatedAt!.hasDefault).toBe(true)
  })

  test('keeps declared id and updated_at columns instead of injecting duplicates', () => {
    const config = columnConfig(
      { title: 'Widget'
      , type: 'object'
      , properties:
        { id: { type: 'string', format: 'uuid', 'x-primary': true }
        , updated_at: { type: 'string', format: 'date-time' }
        }
      })

    expect(config.columns.map(x => x.name)).toEqual(['id', 'updated_at'])
  })

  test('places id and updated_at first and snake_cases every column', () => {
    const config = columnConfig(
      { title: 'Widget'
      , type: 'object'
      , properties:
        { displayName: { type: 'string' }
        , createdAt: { type: 'string', format: 'date-time' }
        }
      })

    expect(config.columns.map(x => x.name))
      .toEqual(['id', 'updated_at', 'display_name', 'created_at'])
  })
})

describe('buildSchema column types', () => {
  test('maps supported JSON Schema types', () => {
    const config = columnConfig(
      { title: 'Types'
      , type: 'object'
      , properties:
        { name: { type: 'string' }
        , uuid: { type: 'string', format: 'uuid' }
        , when: { type: 'string', format: 'date-time' }
        , bytes: { type: 'string', format: 'byte' }
        , count: { type: 'integer' }
        , ratio: { type: 'number' }
        , active: { type: 'boolean' }
        , meta: { type: 'object' }
        , tags: { type: 'array', items: { type: 'string' } }
        , kind: { type: 'string', enum: ['one', 'two'] }
        }
      })

    const byName = Object.fromEntries(config.columns.map(x => [x.name, x]))
    expect(byName.name!.getSQLType()).toBe('text')
    expect(byName.uuid!.getSQLType()).toBe('blob')
    expect(byName.when!.getSQLType()).toBe('integer')
    expect(byName.bytes!.getSQLType()).toBe('blob')
    expect(byName.count!.getSQLType()).toBe('integer')
    expect(byName.ratio!.getSQLType()).toBe('real')
    expect(byName.active!.getSQLType()).toBe('integer')
    expect(byName.active!.dataType).toBe('boolean')
    expect(byName.meta!.dataType).toContain('json')
    expect(byName.tags!.dataType).toContain('json')
    expect(byName.kind!.enumValues).toEqual(['one', 'two'])
  })

  test('honours required, x-unique, x-primary, and defaults', () => {
    const config = columnConfig(
      { title: 'Widget'
      , type: 'object'
      , required: ['name']
      , properties:
        { name: { type: 'string', 'x-unique': true }
        , slug: { type: 'string', 'x-unique': true, default: 'untitled' }
        , count: { type: 'integer', default: 3 }
        , payload: { type: 'object', default: { a: 1 } }
        , flags: { type: 'array', default: ['a'] }
        }
      })

    const byName = Object.fromEntries(config.columns.map(x => [x.name, x]))
    expect(byName.name!.notNull).toBe(true)
    expect(byName.name!.isUnique).toBe(true)
    expect(byName.slug!.isUnique).toBe(true)
    expect(byName.slug!.hasDefault).toBe(true)
    expect(byName.count!.hasDefault).toBe(true)
    expect(byName.payload!.hasDefault).toBe(true)
    expect(byName.flags!.hasDefault).toBe(true)
  })

  test('rejects duplicate columns, primary keys, and table names', () => {
    expect(() => columnConfig(
      { title: 'Widget'
      , type: 'object'
      , properties:
        { displayName: { type: 'string' }
        , display_name: { type: 'string' }
        }
      })).toThrow('duplicate column')

    expect(() => columnConfig(
      { title: 'Widget'
      , type: 'object'
      , properties:
        { a: { type: 'string', 'x-primary': true }
        , b: { type: 'string', 'x-primary': true }
        }
      })).toThrow('multiple primary keys')

    expect(() => buildSchema(
      [ loadedSchema({ title: 'Widget', type: 'object', properties: {} })
      , loadedSchema({ title: 'Widget', type: 'object', properties: {} })
      ])).toThrow('Duplicate table name')
  })
})

describe('buildSchema relations', () => {
  test('keeps relation metadata and validates its shape', () => {
    const built = buildSchema(
      [ loadedSchema(userSchema)
      , loadedSchema(
          { title: 'Widget'
          , type: 'object'
          , properties: {}
          , 'x-relations':
            { owner:
              { table: 'user'
              , column: 'id'
              , cardinality: 'one'
              , foreignKey: 'owner_id'
              , onDelete: 'restrict'
              }
            }
          })
      ])

    expect(built.tables.Widget!.relations.owner).toEqual(
      { table: 'user'
      , column: 'id'
      , cardinality: 'one'
      , foreignKey: 'owner_id'
      , onDelete: 'restrict'
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
            { owner:
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
      .toEqual(['id', 'updated_at', 'user_id'])
    expect(widget.foreignKeys).toEqual(
      [ { columns: ['user_id']
        , foreignTable: 'user'
        , foreignColumns: ['id']
        , onDelete: 'restrict'
        }
      ])

    const config = getTableConfig(widget.drizzleSchema)
    expect(config.foreignKeys).toHaveLength(1)
    expect(config.indexes.map(x => (x.config.columns[0] as any).name))
      .toEqual(['user_id'])
  })

  test('makes required one relation columns not null', () => {
    const built = buildSchema(
      [ loadedSchema(userSchema)
      , loadedSchema(
          { title: 'Widget'
          , type: 'object'
          , properties: {}
          , 'x-relations':
            { owner:
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
      .toEqual(['id', 'updated_at', 'article_id', 'tag_id'])

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

    expect(() => buildSchema(
      [ loadedSchema(
          { title: 'Node'
          , type: 'object'
          , properties: {}
          , 'x-relations':
            { children: { table: 'node', column: 'id', cardinality: 'many' } }
          })
      ])).toThrow('Self-referential many-to-many')
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

describe('buildSchema output', () => {
  test('sorts tables deterministically and tracks triggers', () => {
    const built = buildSchema(
      [ loadedSchema({ title: 'Zebra', type: 'object', properties: {} })
      , loadedSchema({ title: 'Apple', type: 'object', properties: {} })
      ])

    expect(built.orderedTables.map(x => x.tableName)).toEqual(['apple', 'zebra'])
    expect(Object.keys(built.triggers)).toEqual(['apple', 'zebra'])
    expect(built.triggers.apple).toContain('CREATE TRIGGER IF NOT EXISTS `apple_updated`')
  })

  test('creates a quoted trigger per table', () => {
    const trigger = createUpdatedTrigger('blog_post')
    expect(trigger).toContain('AFTER UPDATE ON `blog_post`')
    expect(trigger).toContain('WHERE id = OLD.id')
    expect(trigger.endsWith(';')).toBe(true)
  })
})

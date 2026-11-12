import { describe, expect, test } from 'bun:test'
import { buildSchema } from '../../../src/db/build-schema.ts'
import { buildOne, columnConfig, loadedSchema } from './build-schema.helpers.ts'
import { pascalCase, snakeCase } from '../../../src/db/schema-types.ts'

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

    expect(config.tableName).toBe('widget')
    expect(config.columns.map(x => x.columnName))
      .toEqual(['id', 'updated_at', 'owner', 'visibility'])

    const [id, updatedAt] = config.columns
    expect(id!.sql.type).toBe('blob')
    expect(id!.sql.primaryKey).toBe(true)
    expect(id!.sql.notNull).toBe(true)
    expect(id!.sql.default).toBeDefined()

    expect(updatedAt!.sql.type).toBe('integer')
    expect(updatedAt!.sql.notNull).toBe(true)
    expect(updatedAt!.sql.default).toBeDefined()
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

    expect(config.columns.map(x => x.columnName))
      .toEqual(['id', 'updated_at', 'owner', 'visibility'])
  })

  test('places id, updated_at, and owner first and snake_cases every column', () => {
    const config = columnConfig(
      { title: 'Widget'
      , type: 'object'
      , properties:
        { displayName: { type: 'string' }
        , createdAt: { type: 'string', format: 'date-time' }
        }
      })

    expect(config.columns.map(x => x.columnName))
      .toEqual(['id', 'updated_at', 'owner', 'visibility', 'display_name', 'created_at'])
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

    const byName = Object.fromEntries(config.columns.map(x => [x.columnName, x]))
    expect(byName.name!.sql.type).toBe('text')
    expect(byName.uuid!.sql.type).toBe('blob')
    expect(byName.when!.sql.type).toBe('integer')
    expect(byName.bytes!.sql.type).toBe('blob')
    expect(byName.count!.sql.type).toBe('integer')
    expect(byName.ratio!.sql.type).toBe('real')
    expect(byName.active!.sql.type).toBe('integer')
    expect(byName.active!.schema.type).toBe('boolean')
    expect(byName.meta!.schema.type).toBe('object')
    expect(byName.tags!.schema.type).toBe('array')
    expect(byName.kind!.schema.enum).toEqual(['one', 'two'])
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

    const byName = Object.fromEntries(config.columns.map(x => [x.columnName, x]))
    expect(byName.name!.sql.notNull).toBe(true)
    expect(byName.name!.sql.unique).toBe(true)
    expect(byName.slug!.sql.unique).toBe(true)
    expect(byName.slug!.sql.default).toBeDefined()
    expect(byName.count!.sql.default).toBeDefined()
    expect(byName.payload!.sql.default).toBeDefined()
    expect(byName.flags!.sql.default).toBeDefined()
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

describe('buildSchema union types', () => {
  test('collapses [T, "null"] unions onto their non-null member', () => {
    const config = columnConfig(
      { title: 'Widget'
      , type: 'object'
      , properties:
        { rank: { type: ['integer', 'null'] }
        , label: { type: ['null', 'string'], enum: ['a', 'b'] }
        , score: { type: 'number' }
        }
      })

    const byName = Object.fromEntries(config.columns.map(x => [x.columnName, x]))
    expect(byName.rank!.sql.type).toBe('integer')
    expect(byName.label!.sql.type).toBe('text')
    expect(byName.label!.schema.enum).toEqual(['a', 'b'])
    expect(byName.score!.sql.type).toBe('real')
  })

  test('leaves nullability to required, keeping columns nullable', () => {
    const config = columnConfig(
      { title: 'Widget'
      , type: 'object'
      , required: ['rank']
      , properties:
        { rank: { type: ['integer', 'null'] }
        , score: { type: ['integer', 'null'] }
        }
      })

    const byName = Object.fromEntries(config.columns.map(x => [x.columnName, x]))
    expect(byName.rank!.sql.notNull).toBe(true)
    expect(byName.score!.sql.notNull).toBe(false)
  })

  test('normalizes unions nested in object properties and array items', () => {
    const built = buildOne(
      { title: 'Widget'
      , type: 'object'
      , properties:
        { rank: { type: ['integer', 'null'] }
        , meta:
          { type: 'object'
          , properties:
            { depth: { type: ['integer', 'null'] }
            , inner: { type: 'object', properties: { size: { type: ['number', 'null'] } } }
            }
          }
        , tags: { type: 'array', items: { type: ['string', 'null'] } }
        }
      })

    const schema = built.tables.Widget!.schema
    const property = (key: string) => schema.properties![key]!
    expect(property('rank').type).toBe('integer')
    expect(property('meta').properties!.depth!.type).toBe('integer')
    expect(property('meta').properties!.inner!.properties!.size!.type).toBe('number')
    expect(property('tags').items!.type).toBe('string')
  })

  test('rejects unions without exactly one non-null type', () => {
    expect(() => buildOne(
      { title: 'Widget'
      , type: 'object'
      , properties: { rank: { type: ['integer', 'string'] } }
      })).toThrow('Widget: property "rank" type must be a single type, not integer or string')

    expect(() => buildOne(
      { title: 'Widget'
      , type: 'object'
      , properties: { rank: { type: ['null'] } }
      })).toThrow('Widget: property "rank" type must not be "null" only')

    expect(() => buildOne(
      { title: 'Widget'
      , type: 'object'
      , properties:
        { meta:
          { type: 'object'
          , properties: { depth: { type: ['integer', 'string'] } }
          }
        }
      })).toThrow('Widget: property "meta.depth" type must be a single type')
  })
})

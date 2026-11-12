import { describe, expect, test } from 'bun:test'
import { buildSchema } from './build-schema.ts'
import { buildOne, columnConfig, loadedSchema } from './build-schema.helpers.ts'
import { pascalCase, snakeCase } from './schema-types.ts'

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
    expect(config.columns.map(x => x.name))
      .toEqual(['id', 'updated_at', 'owner', 'visibility'])

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

    expect(config.columns.map(x => x.name))
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

    expect(config.columns.map(x => x.name))
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

    const byName = Object.fromEntries(config.columns.map(x => [x.name, x]))
    expect(byName.rank!.getSQLType()).toBe('integer')
    expect(byName.label!.getSQLType()).toBe('text')
    expect(byName.label!.enumValues).toEqual(['a', 'b'])
    expect(byName.score!.getSQLType()).toBe('real')
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

    const byName = Object.fromEntries(config.columns.map(x => [x.name, x]))
    expect(byName.rank!.notNull).toBe(true)
    expect(byName.score!.notNull).toBe(false)
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

import { describe, expect, test } from 'bun:test'
import { buildSchema, createUpdatedTrigger } from '../../../src/db/build-schema.ts'
import { buildOne, loadedSchema, userSchema } from './build-schema.helpers.ts'

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

describe('buildSchema x-exposed', () => {
  test('exposes tables, columns, and relations by default', () => {
    const built = buildSchema(
      [ loadedSchema(userSchema)
      , loadedSchema(
          { title: 'Widget'
          , type: 'object'
          , properties:
            { name: { type: 'string' }
            , secret: { type: 'string', 'x-exposed': false }
            }
          , 'x-relations':
            { member: { table: 'user', column: 'id', cardinality: 'one' } }
          })
      ])

    const widget = built.tables.Widget!
    expect(widget.exposed).toBe(true)
    expect(widget.columns.find(x => x.columnName === 'name')?.exposed)
      .toBe(true)
    expect(widget.columns.find(x => x.columnName === 'secret')?.exposed)
      .toBe(false)
    expect(widget.relations.member?.exposed).toBe(true)
  })

  test('hides tables and relations to hidden tables', () => {
    const built = buildSchema(
      [ loadedSchema(userSchema)
      , loadedSchema(
          { title: 'Secret'
          , type: 'object'
          , 'x-exposed': false
          , properties: { value: { type: 'string' } }
          })
      , loadedSchema(
          { title: 'Widget'
          , type: 'object'
          , properties: {}
          , 'x-relations':
            { member: { table: 'user', column: 'id', cardinality: 'one' }
            , secret: { table: 'secret', column: 'id', cardinality: 'one' }
            , hidden:
                { table: 'user'
                , column: 'id'
                , cardinality: 'one'
                , 'x-exposed': false
                }
            }
          })
      ])

    expect(built.tables.Secret!.exposed).toBe(false)
    expect(built.tables.Widget!.relations.member?.exposed).toBe(true)
    expect(built.tables.Widget!.relations.secret?.exposed).toBe(false)
    expect(built.tables.Widget!.relations.hidden?.exposed).toBe(false)
  })

  test('hides derived join tables with hidden endpoints or relations', () => {
    const built = buildSchema(
      [ loadedSchema(
          { title: 'Article'
          , type: 'object'
          , properties: { heading: { type: 'string' } }
          , 'x-relations':
            { tag: { table: 'tag', column: 'id', cardinality: 'many' } }
          })
      , loadedSchema(
          { title: 'Tag'
          , type: 'object'
          , 'x-exposed': false
          , properties: { name: { type: 'string' } }
          })
      ])

    const join = built.tables.ArticleTag!
    expect(join.exposed).toBe(false)
    expect(built.tables.Article!.relations.tag?.exposed).toBe(false)
  })

  test('rejects non-boolean x-exposed values', () => {
    expect(() => buildOne(
      { title: 'Widget'
      , type: 'object'
      , 'x-exposed': 'yes' as unknown as boolean
      , properties: {}
      })).toThrow('x-exposed must be a boolean')

    expect(() => buildOne(
      { title: 'Widget'
      , type: 'object'
      , properties:
        { name: { type: 'string', 'x-exposed': 1 as unknown as boolean } }
      })).toThrow('property "name" x-exposed must be a boolean')

    expect(() => buildSchema(
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
              , 'x-exposed': 'no' as unknown as boolean
              }
            }
          })
      ])).toThrow('relation "member" x-exposed must be a boolean')
  })
})

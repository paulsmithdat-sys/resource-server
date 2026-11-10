import { describe, expect, test } from 'bun:test'
import { buildSchema } from './build-schema.ts'
import { buildViews } from './views.ts'
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

const built = buildSchema(
  [ loadedSchema(
      { title: 'Article'
      , type: 'object'
      , properties:
        { heading: { type: 'string' }
        , published: { type: 'boolean' }
        , metadata: { type: 'object' }
        }
      , 'x-relations':
        { tag: { table: 'tag', column: 'id', cardinality: 'many' } }
      })
  , loadedSchema(
      { title: 'Tag'
      , type: 'object'
      , properties:
        { name: { type: 'string' }
        , metadata: { type: 'object' }
        }
      })
  , loadedSchema(
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

describe('buildViews', () => {
  test('creates one view per table', () => {
    expect(Object.keys(built.views).sort()).toEqual(
      [ 'article_tag_view'
      , 'article_view'
      , 'key_view'
      , 'tag_view'
      , 'user_view'
      ])
    expect(built.views.article_view!.dropSql)
      .toBe('DROP VIEW IF EXISTS `article_view`;')
  })

  test('formats uuid columns as canonical strings', () => {
    const sql = built.views.article_view!.sql
    expect(sql).toContain(
      'lower(hex(substr(`t`.`id`, 1, 4)))'
      + " || '-' || lower(hex(substr(`t`.`id`, 5, 2)))")
    expect(sql).toContain('AS `id`')
  })

  test('nests one relations as json objects', () => {
    const sql = built.views.key_view!.sql
    expect(sql).toContain('(SELECT json_object(')
    expect(sql).toContain('FROM `user` AS `r`')
    expect(sql).toContain('WHERE `r`.`id` = `t`.`user_id`')
    expect(sql).toContain('AS `user`')
  })

  test('aggregates many relations into json arrays', () => {
    const articleSql = built.views.article_view!.sql
    expect(articleSql).toContain('coalesce(json_group_array(json_object(')
    expect(articleSql).toContain('JOIN `article_tag` AS `j`')
    expect(articleSql).toContain('AS `tag`')

    const userSql = built.views.user_view!.sql
    expect(userSql).toContain('coalesce(json_group_array(json_object(')
    expect(userSql).toContain('WHERE `r`.`user_id` = `t`.`id`')
    expect(userSql).toContain('AS `keys`')
  })

  test('embeds json columns as json values in nested objects', () => {
    const sql = built.views.article_view!.sql
    expect(sql).toContain("'metadata', json(`r`.`metadata`)")
  })
})

describe('self-referential many-to-many', () => {
  const selfBuilt = buildSchema(
    [ loadedSchema(
        { title: 'Person'
        , type: 'object'
        , properties: { name: { type: 'string' } }
        , 'x-relations':
          { friends: { table: 'person', column: 'id', cardinality: 'many' }
          , blocked: { table: 'person', column: 'id', cardinality: 'many' }
          }
        })
    ])

  test('derives one join table per relation with distinct side columns', () => {
    const names = selfBuilt.orderedTables.map(x => x.tableName).sort()
    expect(names).toContain('person_friends')
    expect(names).toContain('person_blocked')

    const join = selfBuilt.orderedTables.find(x => x.tableName === 'person_friends')!
    expect(join.foreignKeys.slice(0, 2).map(x => x.columns[0])).toEqual(
      ['person_id', 'related_person_id'])
  })

  test('view joins the source column to the target column', () => {
    const sql = buildViews(selfBuilt).person_view!.sql
    expect(sql).toContain('`j`.`related_person_id` = `r`.`id`')
    expect(sql).toContain('`j`.`person_id` = `t`.`id`')
  })
})

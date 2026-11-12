import { pascalCase, type JSONSchema, type JSONSchemaProperty, type LoadedSchema, type RelationConfig } from '../schema-types.ts'
import { normalizeAccess } from '../access.ts'
import { DERIVED_SOURCE, DEFAULT_ID, tableNameOf } from './helpers.ts'

/** Build the <table>_share schema granting read/write on rows to users or groups. */
export const deriveShareTable =
  (source: JSONSchema): LoadedSchema => {
    const table = tableNameOf(source)
    if (table === 'user' || table === 'user_group')
      throw new Error(`${source.title}: system tables cannot be shareable`)
    const access = normalizeAccess(source)
    const writes = (list: string[]) => list.filter(x => x !== 'read')
    /** A cascading one-relation from the share row to its note, user or group. */
    const target = (name: string, required = false): RelationConfig =>
      ({ table: name
      , column: DEFAULT_ID
      , cardinality: 'one'
      , foreignKey: `${name}_id`
      , onDelete: 'cascade'
      , ...(required ? { required } : { 'x-link-any': true })
      })

    const schema: JSONSchema =
      { $schema: 'https://json-schema.org/draft/2020-12/schema'
      , title: `${source.title} Share`
      , type: 'object'
      , additionalProperties: false
      , description: `Read/write grants on ${table} rows for users or groups`
      , properties:
        { can_read: { type: 'boolean', default: true }
        , can_write: { type: 'boolean', default: false }
        }
      , 'x-relations':
        { [table]: target(table, true)
        , user: target('user')
        , user_group: target('user_group')
        }
      , 'x-unique-constraints':
          [[`${table}_id`, 'user_id'], [`${table}_id`, 'user_group_id']]
      , 'x-checks':
          [ '(`user_id` IS NULL) <> (`user_group_id` IS NULL)'
          , '`can_read` OR `can_write`'
          ]
      , 'x-access':
        { visibility: ['private']
        , signed: writes(access.signed)
        , audited: writes(access.audited)
        }
      }

    return (
      { schema
      , source: DERIVED_SOURCE
      , importPath: DERIVED_SOURCE
      })
  }

/** Collapse type unions like [string, 'null'] to their single non-null member so every consumer sees a plain type string; nullability continues to come from `required`. */
export const normalizePropertyTypes =
  (title: string, property: JSONSchemaProperty, label: string): void => {
    if (Array.isArray(property.type)) {
      const nonNull = property.type.filter(x => x !== 'null')
      if (nonNull.length === 0)
        throw new Error(`${title}: property "${label}" type must not be "null" only`)
      if (nonNull.length > 1)
        throw new Error(
          `${title}: property "${label}" type must be a single type, not `
          + `${nonNull.join(' or ')}`)
      property.type = nonNull[0]!
    }
    if (property.items)
      normalizePropertyTypes(title, property.items, `${label}[]`)
    for (const [key, child] of Object.entries(property.properties ?? {}))
      normalizePropertyTypes(title, child, `${label}.${key}`)
  }

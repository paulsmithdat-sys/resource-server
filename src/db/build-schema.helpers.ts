import { getTableConfig } from 'drizzle-orm/sqlite-core'
import { buildSchema } from './build-schema.ts'
import
  { pascalCase
  , snakeCase
  , type JSONSchema
  , type LoadedSchema
  } from './schema-types.ts'

/** Wrap a schema as if it had been loaded from a file. */
export const loadedSchema =
  (schema: JSONSchema): LoadedSchema => (
    { schema
    , source: `/test/${schema.title}.ts`
    , importPath: `src/schema/${snakeCase(schema.title)}.ts`
    , exportName: `${pascalCase(schema.title)}Schema`
    })

export const buildOne =
  (schema: JSONSchema) => buildSchema([loadedSchema(schema)])

export const userSchema: JSONSchema =
  { title: 'User'
  , type: 'object'
  , properties:
    { name: { type: 'string' } }
  }

export const columnConfig =
  (schema: JSONSchema, tableName?: string) => {
    const built = buildOne(schema)
    const table = tableName
      ? built.tables[tableName]!
      : built.orderedTables[0]!
    return getTableConfig(table.drizzleSchema)
  }


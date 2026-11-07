import { sql } from 'drizzle-orm'
import { blob, integer, real, sqliteTable, text } from 'drizzle-orm/sqlite-core'
import
  { pascalCase
  , snakeCase
  , type BuiltSchema
  , type ColumnDef
  , type JSONSchema
  , type JSONSchemaProperty
  , type LoadedSchema
  , type RelationConfig
  , type TableDef
  } from './schema-types.ts'

const SYSTEM_SCHEMA_DIR = 'src/schema/system/'

const uuidDefault =
  () => sql`(uuid7())`

const timestampDefault =
  () => sql`(cast((julianday('now') - 2440587.5)*86400000 as integer))`

export const createUpdatedTrigger =
  (tableName: string) => `
CREATE TRIGGER IF NOT EXISTS \`${tableName}_updated\`
AFTER UPDATE ON \`${tableName}\`
FOR EACH ROW
WHEN NEW.updated_at = OLD.updated_at
BEGIN
    UPDATE \`${tableName}\`
    SET updated_at = CAST(
      (julianday('now') - 2440587.5) * 86400000 AS INTEGER
    )
    WHERE id = OLD.id;
END;`.trim()

const isStringEnum =
  (value: readonly unknown[] | undefined): value is [string, ...string[]] =>
    Array.isArray(value)
    && value.length > 0
    && value.every(x => typeof x === 'string')

const applyDefault =
  (builder: any, value: unknown, property: JSONSchemaProperty) => {
    if (value === undefined) return builder
    if (property.type === 'object' || property.type === 'array')
      return builder.default(sql`${JSON.stringify(value)}`)
    if (property.format === 'date-time') {
      const millis = typeof value === 'string' ? Date.parse(value) : NaN
      return Number.isFinite(millis) ? builder.default(sql`${millis}`) : builder
    }
    if (property.type === 'boolean')
      return builder.default(value ? 1 : 0)
    return builder.default(value)
  }

const buildColumn =
  ( key: string
  , property: JSONSchemaProperty
  , required: boolean
  , injected: boolean) => {
    const columnName = snakeCase(key)
    let builder: any

    if (property.format === 'uuid')
      builder = blob(columnName)
    else if (property.format === 'date-time')
      builder = integer(columnName, { mode: 'timestamp' })
    else if (property.format === 'byte')
      builder = blob(columnName)
    else if (property.type === 'string')
      builder = isStringEnum(property.enum)
        ? text(columnName, { enum: property.enum })
        : text(columnName)
    else if (property.type === 'integer')
      builder = integer(columnName)
    else if (property.type === 'number')
      builder = real(columnName)
    else if (property.type === 'boolean')
      builder = integer(columnName, { mode: 'boolean' })
    else if (property.type === 'object' || property.type === 'array')
      builder = text(columnName, { mode: 'json' })
    else
      builder = text(columnName)

    if (injected && key === 'id')
      builder = builder.default(uuidDefault())
    else if (property.default !== undefined)
      builder = applyDefault(builder, property.default, property)
    else if (columnName === 'updated_at')
      builder = builder.default(sql`(cast((julianday('now') - 2440587.5)*86400000 as integer))`)

    if (required || key === 'id' || columnName === 'updated_at')
      builder = builder.notNull()

    if (property['x-unique'])
      builder = builder.unique()

    if (property['x-primary'] || key === 'id')
      builder = builder.primaryKey()

    return builder
  }

const validateRelation =
  (sourceTitle: string, label: string, relation: RelationConfig) => {
    if (!relation || typeof relation !== 'object')
      throw new Error(`${sourceTitle}: relation "${label}" must be an object`)
    if (typeof relation.table !== 'string' || relation.table.length === 0)
      throw new Error(`${sourceTitle}: relation "${label}" needs a table`)
    if (relation.cardinality !== 'one' && relation.cardinality !== 'many')
      throw new Error(`${sourceTitle}: relation "${label}" cardinality must be "one" or "many"`)
    if (relation.column !== undefined && typeof relation.column !== 'string')
      throw new Error(`${sourceTitle}: relation "${label}" column must be a string`)
    if (relation.foreignKey !== undefined && typeof relation.foreignKey !== 'string')
      throw new Error(`${sourceTitle}: relation "${label}" foreignKey must be a string`)
    if (relation.through !== undefined && typeof relation.through !== 'string')
      throw new Error(`${sourceTitle}: relation "${label}" through must be a string`)
  }

const buildTable =
  (loaded: LoadedSchema): TableDef => {
    const schema = loaded.schema
    const properties = { ...(schema.properties ?? {}) }
    const injected = new Set<string>()

    if (!properties.id) {
      properties.id = { type: 'string', format: 'uuid', 'x-primary': true }
      injected.add('id')
    }
    if (!properties.updated_at) {
      properties.updated_at = { type: 'string', format: 'date-time' }
      injected.add('updated_at')
    }

    const required = new Set(schema.required ?? [])
    if (properties.id) required.add('id')
    if (properties.updated_at) required.add('updated_at')

    const orderedProperties: [string, JSONSchemaProperty][] = []
    if (properties.id) orderedProperties.push(['id', properties.id])
    if (properties.updated_at) orderedProperties.push(['updated_at', properties.updated_at])
    for (const [key, value] of Object.entries(schema.properties ?? {}))
      if (key !== 'id' && key !== 'updated_at')
        orderedProperties.push([key, value])

    const columns: ColumnDef[] =
      orderedProperties.map(([key, property]) => (
        { key
        , columnName: snakeCase(key)
        , schema: property
        , drizzle:
            buildColumn(key, property, required.has(key), injected.has(key))
        , required: required.has(key)
        , injected: injected.has(key)
        }))

    const columnNames = new Set<string>()
    for (const column of columns) {
      if (columnNames.has(column.columnName))
        throw new Error(`${schema.title}: duplicate column "${column.columnName}"`)
      columnNames.add(column.columnName)
    }

    const primaryKeys = columns.filter(x => x.schema['x-primary'] || x.key === 'id')
    if (primaryKeys.length > 1)
      throw new Error(
        `${schema.title}: multiple primary keys: ${primaryKeys.map(x => x.columnName).join(', ')}`)

    const relations = schema['x-relations'] ?? {}
    for (const [label, relation] of Object.entries(relations))
      validateRelation(schema.title, label, relation)

    const tableName = snakeCase(schema.title)
    const drizzleSchema = sqliteTable(
      tableName
      , Object.fromEntries(columns.map(x => [x.key, x.drizzle])))

    return (
      { key: pascalCase(schema.title)
      , tableName
      , drizzleSchema
      , schema
      , columns
      , isSystem: schema['x-system'] === true || loaded.importPath.startsWith(SYSTEM_SCHEMA_DIR)
      , relations
      , trigger: createUpdatedTrigger(tableName)
      })
  }

export const buildSchema =
  (schemas: LoadedSchema[]): BuiltSchema => {
    const orderedTables = schemas.map(buildTable)
    const tables: Record<string, TableDef> = {}

    for (const table of orderedTables) {
      if (tables[table.key])
        throw new Error(`Duplicate table export "${table.key}"`)
      tables[table.key] = table
    }

    const tableNames = new Set<string>()
    for (const table of orderedTables) {
      if (tableNames.has(table.tableName))
        throw new Error(`Duplicate table name "${table.tableName}"`)
      tableNames.add(table.tableName)
    }

    orderedTables.sort((a, b) => a.tableName.localeCompare(b.tableName))

    return (
      { tables
      , orderedTables
      , triggers: Object.fromEntries(
          orderedTables.map(x => [x.tableName, x.trigger]))
      , views: {}
      })
  }

export type { JSONSchema }

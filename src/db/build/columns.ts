import { sql } from 'drizzle-orm'
import { blob, integer, real, text, unique } from 'drizzle-orm/sqlite-core'
import { snakeCase, type ColumnBuilder, type JSONSchemaProperty } from '../schema-types.ts'

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

export const validateExposure =
  (title: string, value: unknown, label: string) => {
    if (value !== undefined && typeof value !== 'boolean')
      throw new Error(`${title}: ${label} x-exposed must be a boolean`)
  }

const applyDefault =
  (builder: ColumnBuilder, value: unknown, property: JSONSchemaProperty): ColumnBuilder => {
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

export const buildColumn =
  ( key: string
  , property: JSONSchemaProperty
  , required: boolean): ColumnBuilder => {
    const columnName = snakeCase(key)
    let builder: ColumnBuilder

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

    if (property.default !== undefined)
      builder = applyDefault(builder, property.default, property)
    else if (columnName === 'id')
      builder = builder.default(uuidDefault())
    else if (columnName === 'updated_at')
      builder = builder.default(timestampDefault())

    if (required || columnName === 'id' || columnName === 'updated_at')
      builder = builder.notNull()

    if (property['x-unique'])
      builder = builder.unique()

    if (property['x-primary'] || columnName === 'id')
      builder = builder.primaryKey()

    return builder
  }

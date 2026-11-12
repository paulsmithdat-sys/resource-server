import { snakeCase, type ColumnSql, type JSONSchemaProperty } from '../schema-types.ts'

const UUID_DEFAULT = '(uuid7())'

const TIMESTAMP_DEFAULT =
  "(cast((julianday('now') - 2440587.5)*86400000 as integer))"

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

export const validateExposure =
  (title: string, value: unknown, label: string) => {
    if (value !== undefined && typeof value !== 'boolean')
      throw new Error(`${title}: ${label} x-exposed must be a boolean`)
  }

const quoted = (value: string) => `'${value.replaceAll("'", "''")}'`

/** A schema default as a SQL literal, or undefined when it cannot be stored. */
const defaultSql =
  (value: unknown, property: JSONSchemaProperty) => {
    if (property.type === 'object' || property.type === 'array')
      return quoted(JSON.stringify(value))
    if (property.format === 'date-time') {
      const millis = typeof value === 'string' ? Date.parse(value) : NaN
      return Number.isFinite(millis) ? String(millis) : undefined
    }
    if (property.type === 'boolean') return value ? '1' : '0'
    return typeof value === 'string' ? quoted(value) : String(value)
  }

const typeOf =
  (property: JSONSchemaProperty): ColumnSql['type'] => {
    if (property.format === 'uuid' || property.format === 'byte') return 'blob'
    if (property.format === 'date-time') return 'integer'
    if (property.type === 'integer' || property.type === 'boolean') return 'integer'
    if (property.type === 'number') return 'real'
    return 'text'
  }

/** The SQLite declaration of a column built from a schema property. */
export const buildColumn =
  (key: string, property: JSONSchemaProperty, required: boolean): ColumnSql => {
    const columnName = snakeCase(key)
    const isId = columnName === 'id'
    const isUpdatedAt = columnName === 'updated_at'
    const fallback =
      isId ? UUID_DEFAULT : isUpdatedAt ? TIMESTAMP_DEFAULT : undefined
    const declared =
      property.default === undefined ? undefined : defaultSql(property.default, property)

    return (
      { type: typeOf(property)
      , notNull: required || isId || isUpdatedAt
      , unique: property['x-unique'] === true
      , primaryKey: property['x-primary'] === true || isId
      , ...(declared ?? fallback ? { default: declared ?? fallback } : {})
      })
  }

import type { ColumnDef, RelationConfig, TableDef } from '../../db/schema-types.ts'
import { badRequest, conflict, forbidden } from '../errors.ts'
import type { ResourceMeta } from '../registry.ts'
import { type Values } from '../sql.ts'
import { uuidToBuffer } from '../uuid.ts'
import { type MutationContext, type WriteDocument, type Mode } from './types.ts'
import { writableAttributes } from './parse.ts'
import { exposedRelations } from './relationships.ts'

const coerceValue =
  ( column: ColumnDef
  , value: unknown
  ): unknown => {
    if (value === null) return null

    const property = column.schema

    if (property.format === 'uuid')
      return uuidToBuffer(value as string)

    if (property.format === 'date-time') {
      if (typeof value === 'number' && Number.isFinite(value))
        return Math.trunc(value)
      if (typeof value === 'string')
        return Date.parse(value)
    }

    if (property.format === 'byte')
      return Buffer.from(value as string, 'base64')

    if (property.type === 'object' || property.type === 'array')
      return JSON.stringify(value)

    if (property.type === 'boolean')
      return value ? 1 : 0

    return value
  }

const columnFor =
  (resource: ResourceMeta, columnName: string) => {
    const column =
      resource.definition.columns.find(x => x.columnName === columnName)
    if (!column)
      throw new Error(
        `${resource.type}: column "${columnName}" does not exist`)
    return column
  }

/** Turn written attributes into column values (PUT resets omitted ones). */
export const assertRequiredAttributes =
  (resource: ResourceMeta, provided: Set<string>) => {
    for (const column of resource.definition.columns) {
      if (!column.exposed) continue
      if (!column.required
          || column.injected
          || column.columnName === 'updated_at'
          || resource.foreignKeyColumns.includes(column.columnName)
          || column.schema.default !== undefined)
        continue

      if (!provided.has(column.columnName))
        throw badRequest(
          `Attribute "${column.columnName}" is required`
          , `data.attributes.${column.columnName}`)
    }
  }

export const attributeAssignments =
  async (
    context: MutationContext,
    resource: ResourceMeta,
    document: WriteDocument,
    mode: Mode) => {
    const { attributes } = document
    const names =
      mode === 'put' ? writableAttributes(resource) : Object.keys(attributes)
    const assignments: Values = {}

    for (const name of names) {
      // The owner is never taken from the client: it is the signed-in creator.
      if (name === 'owner') continue
      // Shared writers may edit content but not who can read it.
      if (name === 'visibility' && context.isOwner === false) {
        if (Object.hasOwn(attributes, name))
          throw forbidden('Only the owner can change visibility', 'data.attributes.visibility')
        continue
      }

      const column = columnFor(resource, name)
      let value = attributes[name]
      if (!Object.hasOwn(attributes, name)) {
        if (column.required && column.schema.default === undefined)
          throw badRequest(
            `Attribute "${name}" is required`, `data.attributes.${name}`)
        value = column.required ? column.schema.default : null
      }

      assignments[name] = coerceValue(column, value)
    }

    return assignments
  }

/** Turn to-one relationships into foreign key column values. */
export const foreignKeyAssignments =
  (resource: ResourceMeta, document: WriteDocument, mode: Mode) => {
    const assignments: Values = {}

    for (const [label, relation] of exposedRelations(resource, 'one')) {
      const value = document.relationships.get(label)
      const column = foreignKeyColumn(resource.definition, relation)
      const missing =
        () => badRequest(
          `Relationship "${label}" is required`
          , `data.relationships.${label}`)

      if (value === undefined) {
        if (relation.required && mode !== 'patch') throw missing()
        if (mode === 'put') assignments[column] = null
        continue
      }

      if (Array.isArray(value))
        throw new Error(`Relationship "${label}" is not to-one`)
      if (value === null && relation.required) throw missing()

      assignments[column] = value === null ? null : uuidToBuffer(value)
    }

    return assignments
  }

export const writeError =
  (error: unknown) => {
    const message =
      error instanceof Error ? error.message : String(error)

    if (/UNIQUE constraint failed/i.test(message)
        || /FOREIGN KEY constraint failed/i.test(message)
        || /constraint failed/i.test(message))
      return conflict(message)

    return error instanceof Error ? error : new Error(message)
  }

export const foreignKeyColumn =
  (table: TableDef, relation: RelationConfig) => {
    const column =
      relation.foreignKey
      ?? table.foreignKeys.find(x => x.foreignTable === relation.table)?.columns[0]
    if (!column)
      throw new Error(
        `${table.tableName}: relation to "${relation.table}" has no foreign key`)
    return column
  }

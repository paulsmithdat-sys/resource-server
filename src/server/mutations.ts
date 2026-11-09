import type
  { BuiltSchema
  , ColumnDef
  , RelationConfig
  , TableDef
  } from '../db/schema-types.ts'
import type { Row, RowDatabase } from './database.ts'
import { badRequest, conflict, forbidden, notFound } from './errors.ts'
import { isObject } from './guard.ts'
import { ajv } from './ajv.ts'
import type { ResourceMeta, RelationshipMeta } from './registry.ts'
import { quoteIdentifier } from './query.ts'
import { UUID_PATTERN, canonicalUuid, uuidToBuffer } from './uuid.ts'

export type MutationContext =
  { built: BuiltSchema
  , db: RowDatabase
  , userId?: string
  }

export type WriteDocument =
  { id?: string
  , attributes: Record<string, unknown>
  , relationships: Map<string, string | null | string[]>
  }

type AttributeValidator = (data: unknown) => boolean

const attributeValidators =
  new Map<string, AttributeValidator>()

const buildAttributeValidator =
  (resource: ResourceMeta): AttributeValidator => {
    const cached = attributeValidators.get(resource.type)
    if (cached) return cached

    const columns = resource.definition.columns.filter(
      x => x.exposed
        && x.columnName !== 'updated_at'
        && x.columnName !== 'id')

    const properties: Record<string, unknown> = {}
    for (const column of columns) {
      const property = column.schema
      const prop: Record<string, unknown> = {}
      if (property.type) prop.type = property.type
      if (property.format) prop.format = property.format
      if (property.enum) prop.enum = property.enum
      if (property.minLength !== undefined) prop.minLength = property.minLength
      if (property.maxLength !== undefined) prop.maxLength = property.maxLength
      properties[column.columnName] = prop
    }

    const validator =
      ajv.compile(
        { type: 'object'
        , additionalProperties: false
        , properties
        })

    attributeValidators.set(resource.type, validator)
    return validator
  }

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

const identifier =
  ( value: unknown
  , label: string
  , expectedType: string) => {
    if (!isObject(value)
        || value.type !== expectedType
        || typeof value.id !== 'string'
        || !UUID_PATTERN.test(value.id))
      throw badRequest(
        `Relationship "${label}" must contain "${expectedType}" identifiers`
        , `relationships.${label}`)

    return value.id.toLowerCase()
  }

const parseRelationship =
  ( label: string
  , value: unknown
  , meta: RelationshipMeta): string | null | string[] => {
    if (!isObject(value) || !Object.hasOwn(value, 'data'))
      throw badRequest(
        `Relationship "${label}" must contain "data"`, `relationships.${label}`)

    if (meta.cardinality === 'one')
      return value.data === null
        ? null
        : identifier(value.data, label, meta.type)

    if (!Array.isArray(value.data))
      throw badRequest(
        `Relationship "${label}" must contain an array of identifiers`
        , `relationships.${label}`)

    return [...new Set(value.data.map(x => identifier(x, label, meta.type)))]
  }

export const parseWriteDocument =
  ( resource: ResourceMeta
  , body: unknown
  , options: { id?: string } = {}): WriteDocument => {
    if (!isObject(body) || !isObject(body.data))
      throw badRequest('Request body must contain a JSON:API "data" object')

    const data = body.data
    if (data.type !== resource.type)
      throw badRequest(
        `Resource type must be "${resource.type}"`, 'data.type')

    let id: string | undefined
    if (data.id !== undefined) {
      if (typeof data.id !== 'string' || !UUID_PATTERN.test(data.id))
        throw badRequest('Resource id must be a canonical UUID', 'data.id')
      id = data.id.toLowerCase()
    }

    if (options.id !== undefined
        && id !== undefined
        && id !== options.id.toLowerCase())
      throw badRequest(
        'Resource id does not match the request path', 'data.id')

    const rawAttributes = data.attributes ?? {}
    if (!isObject(rawAttributes))
      throw badRequest('Attributes must be an object', 'data.attributes')

    const writable = new Set(
      resource.attributes.filter(x => x !== 'updated_at'))
    const attributes: Record<string, unknown> = {}
    for (const [name, value] of Object.entries(rawAttributes)) {
      if (!writable.has(name))
        throw badRequest(
          `Unknown attribute "${name}" for resource "${resource.type}"`
          , `data.attributes.${name}`)
      attributes[name] = value
    }

    const validateAttributes = buildAttributeValidator(resource)
    if (!validateAttributes(attributes)) {
      const error = (validateAttributes as any).errors?.[0]
      let field = error?.instancePath?.replace(/^\//, '')
      if (!field && error?.params?.missingProperty) field = error.params.missingProperty
      if (!field) field = 'data.attributes'
      throw badRequest(
        `Attribute "${field}" is invalid`
        , `data.attributes.${field}`)
    }

    const rawRelationships = data.relationships ?? {}
    if (!isObject(rawRelationships))
      throw badRequest('Relationships must be an object', 'data.relationships')

    const relationships =
      new Map<string, string | null | string[]>()
    for (const [label, value] of Object.entries(rawRelationships)) {
      const meta = resource.relationships[label]
      if (!meta)
        throw badRequest(
          `Unknown relationship "${label}" for resource "${resource.type}"`
          , `data.relationships.${label}`)
      relationships.set(label, parseRelationship(label, value, meta))
    }

    return (
      { ...(id ? { id } : {})
      , attributes
      , relationships
      })
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

const writableAttributes =
  (resource: ResourceMeta) =>
    resource.attributes.filter(x => x !== 'updated_at')

const assertRequiredAttributes =
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

const assertOwner =
  async (db: RowDatabase, value: unknown) => {
    if (value === undefined || value === null) return

    const owner = uuidToBuffer(value as string)
    const row =
      await db.get(`SELECT 1 AS found FROM ${quoteIdentifier('user')}`
        + ` WHERE ${quoteIdentifier('id')} = ? LIMIT 1`, [owner])
    if (!row)
      throw badRequest(
        `Owner "${value}" does not reference an existing user`
        , 'data.attributes.owner')
  }

const foreignKeyColumn =
  (table: TableDef, relation: RelationConfig) => {
    const column =
      relation.foreignKey
      ?? table.foreignKeys.find(x => x.foreignTable === relation.table)?.columns[0]
    if (!column)
      throw new Error(
        `${table.tableName}: relation to "${relation.table}" has no foreign key`)
    return column
  }

const writeError =
  (error: unknown) => {
    const message =
      error instanceof Error ? error.message : String(error)

    if (/UNIQUE constraint failed/i.test(message)
        || /FOREIGN KEY constraint failed/i.test(message)
        || /constraint failed/i.test(message))
      return conflict(message)

    return error instanceof Error ? error : new Error(message)
  }

const replaceManyRelationship =
  async ( context: MutationContext
  , resource: ResourceMeta
  , relation: RelationConfig
  , sourceId: string
  , targetIds: string[]) => {
    if (relation.through) {
      const join =
        context.built.orderedTables.find(
          x => x.tableName === relation.through)
      if (!join)
        throw new Error(
          `${resource.type}: join table "${relation.through}" does not exist`)

      const sourceForeignKey =
        join.foreignKeys.find(x => x.foreignTable === resource.table)
      const targetForeignKey =
        join.foreignKeys.find(x => x.foreignTable === relation.table)
      if (!sourceForeignKey || !targetForeignKey)
        throw new Error(
          `${resource.type}: join table "${relation.through}" needs`
          + ' foreign keys to both tables')

      const sourceColumn = sourceForeignKey.columns[0]!
      const targetColumn = targetForeignKey.columns[0]!
      const sourceBuffer = uuidToBuffer(sourceId)

      await context.db.run(
        `DELETE FROM ${quoteIdentifier(join.tableName)}`
        + ` WHERE ${quoteIdentifier(sourceColumn)} = ?`
        , [sourceBuffer])

      for (const targetId of targetIds)
        await context.db.run(
          `INSERT INTO ${quoteIdentifier(join.tableName)}`
          + ` (${quoteIdentifier(sourceColumn)}, ${quoteIdentifier(targetColumn)})`
          + ' VALUES (?, ?)'
          , [sourceBuffer, uuidToBuffer(targetId)])
      return
    }

    const target =
      context.built.orderedTables.find(
        x => x.tableName === relation.table)
    if (!target)
      throw new Error(
        `${resource.type}: relation table "${relation.table}" does not exist`)

    const inverse =
      Object.values(target.relations).find(
        x => x.cardinality === 'one' && x.table === resource.table)
    if (!inverse)
      throw badRequest(
        `Cannot write many relationship "${relation.table}" without`
        + ' a join table or inverse one relation')

    const foreignKey = foreignKeyColumn(target, inverse)
    const sourceBuffer = uuidToBuffer(sourceId)

    await context.db.run(
      `UPDATE ${quoteIdentifier(target.tableName)}`
      + ` SET ${quoteIdentifier(foreignKey)} = NULL`
      + ` WHERE ${quoteIdentifier(foreignKey)} = ?`
      , [sourceBuffer])

    for (const targetId of targetIds)
      await context.db.run(
        `UPDATE ${quoteIdentifier(target.tableName)}`
        + ` SET ${quoteIdentifier(foreignKey)} = ?`
        + ` WHERE ${quoteIdentifier('id')} = ?`
        , [sourceBuffer, uuidToBuffer(targetId)])
  }

export const readResourceRow =
  async (db: RowDatabase, resource: ResourceMeta, id: string, userId?: string): Promise<Row | undefined> => {
    if (userId) {
      return db.get(
        `SELECT * FROM ${quoteIdentifier(resource.view)}`
        + ` WHERE ${quoteIdentifier('id')} = ?`
        + ` AND ${quoteIdentifier('owner')} = ? LIMIT 1`
        , [id, userId])
    }
    return db.get(
      `SELECT * FROM ${quoteIdentifier(resource.view)}`
      + ` WHERE ${quoteIdentifier('id')} = ? LIMIT 1`
      , [id])
  }

export const createResource =
  async ( context: MutationContext
  , resource: ResourceMeta
  , document: WriteDocument): Promise<string> => {
    assertRequiredAttributes(
      resource, new Set(Object.keys(document.attributes)))

    const columns: string[] = []
    const values: unknown[] = []

    if (document.id) {
      columns.push('id')
      values.push(uuidToBuffer(document.id))
    }

    for (const [name, value] of Object.entries(document.attributes)) {
      if (name === 'owner' && context.userId !== undefined)
        continue
      if (name === 'owner') await assertOwner(context.db, value)
      columns.push(name)
      values.push(coerceValue(columnFor(resource, name), value))
    }

    if (context.userId !== undefined) {
      columns.push('owner')
      values.push(uuidToBuffer(context.userId))
    }

    for (const [label, relation] of Object.entries(resource.definition.relations)) {
      if (relation.cardinality !== 'one' || relation.exposed === false) continue

      const value = document.relationships.get(label)
      if (value === undefined) {
        if (relation.required)
          throw badRequest(
            `Relationship "${label}" is required`
            , `data.relationships.${label}`)
        continue
      }

      if (Array.isArray(value))
        throw new Error(`Relationship "${label}" is not to-one`)

      columns.push(foreignKeyColumn(resource.definition, relation))
      values.push(value === null ? null : uuidToBuffer(value))
    }

    const sql =
      columns.length === 0
        ? `INSERT INTO ${quoteIdentifier(resource.table)}`
          + ' DEFAULT VALUES RETURNING `id`'
        : `INSERT INTO ${quoteIdentifier(resource.table)}`
          + ` (${columns.map(quoteIdentifier).join(', ')})`
          + ` VALUES (${columns.map(() => '?').join(', ')})`
          + ' RETURNING `id`'

    let inserted: Row | undefined
    try {
      inserted = await context.db.get(sql, values)
    } catch (error) {
      throw writeError(error)
    }

    const id = canonicalUuid(inserted?.id)

    for (const [label, relation] of Object.entries(resource.definition.relations)) {
      if (relation.cardinality !== 'many' || relation.exposed === false) continue

      const targets = document.relationships.get(label)
      if (targets === undefined) continue
      await replaceManyRelationship(
        context
        , resource
        , relation
        , id
        , Array.isArray(targets) ? targets : [])
    }

    return id
  }

export const updateResource =
  async ( context: MutationContext
  , resource: ResourceMeta
  , id: string
  , document: WriteDocument
  , mode: 'patch' | 'put'): Promise<void> => {
    const existing = await readResourceRow(context.db, resource, id, context.userId)
    if (!existing)
      throw notFound(`Resource "${resource.type}" with id "${id}" was not found`)

    const assignments = new Map<string, unknown>()

    if (mode === 'put') {
      for (const name of writableAttributes(resource)) {
        const column = columnFor(resource, name)
        if (Object.hasOwn(document.attributes, name)) {
          if (name === 'owner')
            await assertOwner(context.db, document.attributes[name])
          assignments.set(name, coerceValue(column, document.attributes[name]))
        }
        else if (column.required) {
          if (column.schema.default === undefined)
            throw badRequest(
              `Attribute "${name}" is required`
              , `data.attributes.${name}`)
          assignments.set(name, coerceValue(column, column.schema.default))
        }
        else {
          assignments.set(name, null)
        }
      }
    }
    else {
      for (const [name, value] of Object.entries(document.attributes)) {
        if (name === 'owner') await assertOwner(context.db, value)
        assignments.set(name, coerceValue(columnFor(resource, name), value))
      }
    }

    for (const [label, relation] of Object.entries(resource.definition.relations)) {
      if (relation.cardinality !== 'one' || relation.exposed === false) continue

      const value = document.relationships.get(label)
      if (value === undefined) {
        if (mode === 'put') {
          if (relation.required)
            throw badRequest(
              `Relationship "${label}" is required`
              , `data.relationships.${label}`)
          assignments.set(foreignKeyColumn(resource.definition, relation), null)
        }
        continue
      }

      if (value === null && relation.required)
        throw badRequest(
          `Relationship "${label}" is required`
          , `data.relationships.${label}`)

      if (Array.isArray(value))
        throw new Error(`Relationship "${label}" is not to-one`)

      assignments.set(
        foreignKeyColumn(resource.definition, relation)
        , value === null ? null : uuidToBuffer(value))
    }

    if (assignments.size > 0) {
      const entries = [...assignments]
      try {
        await context.db.run(
          `UPDATE ${quoteIdentifier(resource.table)} SET `
          + entries
              .map(([column]) => `${quoteIdentifier(column)} = ?`)
              .join(', ')
          + ` WHERE ${quoteIdentifier('id')} = ?`
          , [...entries.map(([, value]) => value), uuidToBuffer(id)])
      } catch (error) {
        throw writeError(error)
      }
    }

    for (const [label, relation] of Object.entries(resource.definition.relations)) {
      if (relation.cardinality !== 'many' || relation.exposed === false) continue

      let targets = document.relationships.get(label)
      if (targets === undefined) {
        if (mode !== 'put') continue
        targets = []
      }

      await replaceManyRelationship(
        context
        , resource
        , relation
        , id
        , Array.isArray(targets) ? targets : [])
    }
  }

export const deleteResource =
  async ( context: MutationContext
  , resource: ResourceMeta
  , id: string): Promise<void> => {
    const existing = await readResourceRow(context.db, resource, id, context.userId)
    if (!existing)
      throw notFound(`Resource "${resource.type}" with id "${id}" was not found`)

    const idBuffer = uuidToBuffer(id)

    for (const table of context.built.orderedTables) {
      if (!table.derived) continue

      for (const foreignKey of table.foreignKeys) {
        if (foreignKey.foreignTable !== resource.table) continue
        await context.db.run(
          `DELETE FROM ${quoteIdentifier(table.tableName)}`
          + ` WHERE ${quoteIdentifier(foreignKey.columns[0]!)} = ?`
          , [idBuffer])
      }
    }

    try {
      await context.db.run(
        `DELETE FROM ${quoteIdentifier(resource.table)}`
        + ` WHERE ${quoteIdentifier('id')} = ?`
        , [idBuffer])
    } catch (error) {
      throw writeError(error)
    }
  }

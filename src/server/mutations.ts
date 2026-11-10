import type
  { BuiltSchema
  , ColumnDef
  , RelationConfig
  , TableDef
  } from '../db/schema-types.ts'
import type { Row, RowDatabase } from './database.ts'
import { badRequest, conflict, forbidden, notFound } from './errors.ts'
import { isObject } from './guard.ts'
import { ajv, errorField } from './ajv.ts'
import type { Registry, ResourceMeta, RelationshipMeta } from './registry.ts'
import { joinForeignKeys } from '../db/views.ts'
import { quoteIdentifier } from './query.ts'
import
  { deleteScope
  , granted
  , writeScope
  , type Scope
  , type Viewer
  } from './scope.ts'
import { exists, insert, remove, update, type Values } from './sql.ts'
import { UUID_PATTERN, canonicalUuid, uuidToBuffer } from './uuid.ts'

export type MutationContext =
  { built: BuiltSchema
  , db: RowDatabase
  , registry: Registry
  , userId?: string
  , anonymous?: boolean
  , roles?: string[]
  , signed?: boolean
  , isOwner?: boolean
  }

const viewerIn =
  (context: MutationContext): Viewer => (
    { userId: context.userId
    , anonymous: context.anonymous
    , roles: context.roles
    , signed: context.signed
    })

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

    const keys = ['type', 'format', 'enum', 'minLength', 'maxLength'] as const
    const properties =
      Object.fromEntries(
        columns.map(column => (
          [ column.columnName
          , Object.fromEntries(
              keys
                .filter(key => column.schema[key] !== undefined)
                .map(key => [key, column.schema[key]]))
          ])))

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

export const parseRelationship =
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
      const field = errorField(validateAttributes, 'data.attributes')
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

type Mode = 'create' | 'put' | 'patch'

const exposedRelations =
  (resource: ResourceMeta, cardinality?: 'one' | 'many') =>
    Object.entries(resource.definition.relations).filter(
      ([, relation]) =>
        relation.exposed !== false
        && (cardinality === undefined || relation.cardinality === cardinality))

const assertRelationshipTargets =
  async (
    context: MutationContext,
    resource: ResourceMeta,
    document: WriteDocument) => {
    // Purpose: reject links to rows the writer does not own (anonymous writers: non-public rows)
    if (context.userId === undefined && !context.anonymous) return

    for (const [label, relation] of exposedRelations(resource)) {
      const value = document.relationships.get(label)
      const parent =
        label === resource.access.inherit ? context.registry.get(relation.table) : undefined
      for (const id of [value ?? []].flat()) {
        // A row may join a parent it inherits from when the writer can write to that parent.
        if (parent) {
          if (!await readResourceRow(
            context.db, parent, id, writeScope(viewerIn(context), parent)))
            throw notFound(`Related ${relation.table} "${id}" was not found`)
          continue
        }
        const condition =
          relation['x-link-any'] ? {}
          : context.userId !== undefined ? { owner: uuidToBuffer(context.userId) }
          : { visibility: 'public' }
        if (!await exists(
          context.db, relation.table, { id: uuidToBuffer(id), ...condition }))
          throw notFound(`Related ${relation.table} "${id}" was not found`)
      }
    }
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

      const { source: sourceForeignKey, target: targetForeignKey } =
        joinForeignKeys(join, resource.table, relation.table)
      if (!sourceForeignKey || !targetForeignKey)
        throw new Error(
          `${resource.type}: join table "${relation.through}" needs`
          + ' foreign keys to both tables')

      const sourceColumn = sourceForeignKey.columns[0]!
      const targetColumn = targetForeignKey.columns[0]!
      const sourceBuffer = uuidToBuffer(sourceId)

      await remove(context.db, join.tableName, { [sourceColumn]: sourceBuffer })

      for (const targetId of targetIds)
        await insert(
          context.db, join.tableName
          , { [sourceColumn]: sourceBuffer
            , [targetColumn]: uuidToBuffer(targetId)
            // The link belongs to whoever made it.
            , ...(context.userId ? { owner: uuidToBuffer(context.userId) } : {})
            })
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

    await update(
      context.db, target.tableName, { [foreignKey]: null }, { [foreignKey]: sourceBuffer })

    for (const targetId of targetIds)
      await update(
        context.db, target.tableName
        , { [foreignKey]: sourceBuffer }, { id: uuidToBuffer(targetId) })
  }

export const readResourceRow =
  (db: RowDatabase, resource: ResourceMeta, id: string, scope: Scope = { sql: '', params: [] }): Promise<Row | undefined> =>
    db.get(
      `SELECT * FROM ${quoteIdentifier(resource.view)} WHERE \`id\` = ?`
      + (scope.sql ? ` AND ${scope.sql}` : '')
      + ' LIMIT 1'
      , [id, ...scope.params])

const attributeAssignments =
  async (
    context: MutationContext,
    resource: ResourceMeta,
    document: WriteDocument,
    mode: Mode) => {
    // Purpose: turn written attributes into column values (PUT resets omitted ones)
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

const foreignKeyAssignments =
  (resource: ResourceMeta, document: WriteDocument, mode: Mode) => {
    // Purpose: turn to-one relationships into foreign key column values
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

const replaceManyRelationships =
  async (
    context: MutationContext,
    resource: ResourceMeta,
    id: string,
    document: WriteDocument,
    mode: Mode) => {
    // Purpose: rewrite to-many relationships that were written (PUT clears the rest)
    for (const [label, relation] of exposedRelations(resource, 'many')) {
      const targets =
        document.relationships.get(label) ?? (mode === 'put' ? [] : undefined)
      if (targets === undefined) continue

      await replaceManyRelationship(
        context, resource, relation, id, [targets].flat() as string[])
    }
  }

export const createResource =
  async ( context: MutationContext
  , resource: ResourceMeta
  , document: WriteDocument): Promise<string> => {
    if (resource.access.create === 'role'
        && (context.userId !== undefined || context.anonymous)
        && !granted(viewerIn(context), resource, 'create'))
      throw forbidden(`Creating "${resource.type}" needs a role that allows it`)

    assertRequiredAttributes(
      resource, new Set(Object.keys(document.attributes)))
    await assertRelationshipTargets(context, resource, document)

    const assignments =
      { ...(document.id ? { id: uuidToBuffer(document.id) } : {})
      , ...await attributeAssignments(context, resource, document, 'create')
      , ...(context.userId !== undefined
          ? { owner: uuidToBuffer(context.userId) }
          : {})
      , ...foreignKeyAssignments(resource, document, 'create')
      }

    let inserted: Row | undefined
    try {
      inserted = await insert(context.db, resource.table, assignments)
    } catch (error) {
      throw writeError(error)
    }

    const id = canonicalUuid(inserted?.id)
    await replaceManyRelationships(context, resource, id, document, 'create')
    return id
  }

export const updateResource =
  async ( context: MutationContext
  , resource: ResourceMeta
  , id: string
  , document: WriteDocument
  , mode: 'patch' | 'put'): Promise<void> => {
    const existing =
      await readResourceRow(
        context.db, resource, id, writeScope(viewerIn(context), resource))
    if (!existing)
      throw notFound(`Resource "${resource.type}" with id "${id}" was not found`)
    context =
      { ...context
      , isOwner:
          context.userId === undefined
          || existing.owner === context.userId
          || granted(viewerIn(context), resource, 'update')
      }
    await assertRelationshipTargets(context, resource, document)

    const assignments =
      { ...await attributeAssignments(context, resource, document, mode)
      , ...foreignKeyAssignments(resource, document, mode)
      }

    if (Object.keys(assignments).length > 0) {
      try {
        await update(
          context.db, resource.table, assignments, { id: uuidToBuffer(id) })
      } catch (error) {
        throw writeError(error)
      }
    }

    await replaceManyRelationships(context, resource, id, document, mode)
  }

export const deleteResource =
  async ( context: MutationContext
  , resource: ResourceMeta
  , id: string): Promise<void> => {
    const existing =
      await readResourceRow(
        context.db, resource, id, deleteScope(viewerIn(context), resource))
    if (!existing)
      throw notFound(`Resource "${resource.type}" with id "${id}" was not found`)

    const idBuffer = uuidToBuffer(id)

    for (const table of context.built.orderedTables) {
      if (!table.derived) continue

      for (const foreignKey of table.foreignKeys) {
        if (foreignKey.foreignTable !== resource.table) continue
        await remove(
          context.db, table.tableName, { [foreignKey.columns[0]!]: idBuffer })
      }
    }

    try {
      await remove(context.db, resource.table, { id: idBuffer })
    } catch (error) {
      throw writeError(error)
    }
  }

export const changeRelationship =
  async ( context: MutationContext
  , resource: ResourceMeta
  , id: string
  , label: string
  , value: string | null | string[]
  , how: 'replace' | 'add' | 'remove'): Promise<void> => {
    // Purpose: replace a relationship, or add to / remove from a to-many one, as its own request
    const relationships = new Map([[label, value]])
    if (how === 'replace')
      return updateResource(
        context, resource, id, { attributes: {}, relationships }, 'patch')

    const relation = resource.definition.relations[label]!
    if (relation.cardinality !== 'many' || !Array.isArray(value))
      throw forbidden(`Relationship "${label}" is to-one; replace it with PATCH`)

    const existing =
      await readResourceRow(
        context.db, resource, id, writeScope(viewerIn(context), resource))
    if (!existing)
      throw notFound(`Resource "${resource.type}" with id "${id}" was not found`)
    if (how === 'add')
      await assertRelationshipTargets(
        context, resource, { attributes: {}, relationships })

    const current =
      (JSON.parse(String(existing[label] ?? '[]')) as Row[]).map(x => String(x.id))
    const next =
      how === 'add'
        ? [...new Set([...current, ...value])]
        : current.filter(x => !value.includes(x))
    try {
      await replaceManyRelationship(context, resource, relation, id, next)
    } catch (error) {
      throw writeError(error)
    }
  }

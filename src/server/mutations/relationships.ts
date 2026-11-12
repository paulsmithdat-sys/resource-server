import type { RelationConfig } from '../../db/schema-types.ts'
import type { Row } from '../database.ts'
import { badRequest, forbidden, notFound } from '../errors.ts'
import type { ResourceMeta } from '../registry.ts'
import { joinForeignKeys } from '../../db/views.ts'
import { writeScope } from '../scope.ts'
import { exists, insert, remove, update } from '../sql.ts'
import { uuidToBuffer } from '../uuid.ts'
import { type MutationContext, viewerIn, type WriteDocument, type Mode } from './types.ts'
import { writeError, foreignKeyColumn } from './assign.ts'
import { readResourceRow } from './row.ts'
import { updateResource } from './resource.ts'

export const exposedRelations =
  (resource: ResourceMeta, cardinality?: 'one' | 'many') =>
    Object.entries(resource.definition.relations).filter(
      ([, relation]) =>
        relation.exposed !== false
        && (cardinality === undefined || relation.cardinality === cardinality))

export const assertRelationshipTargets =
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

export const replaceManyRelationships =
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

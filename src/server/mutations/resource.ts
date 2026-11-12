import type { Row } from '../database.ts'
import { forbidden, notFound } from '../errors.ts'
import type { ResourceMeta } from '../registry.ts'
import { deleteScope, granted, writeScope } from '../scope.ts'
import { insert, remove, update } from '../sql.ts'
import { canonicalUuid, uuidToBuffer } from '../uuid.ts'
import { type MutationContext, viewerIn, type WriteDocument } from './types.ts'
import { assertRequiredAttributes, attributeAssignments, foreignKeyAssignments, writeError } from './assign.ts'
import { readResourceRow } from './row.ts'
import { assertRelationshipTargets, replaceManyRelationships } from './relationships.ts'

/** Refuse creation of resources the server alone creates, or that need a role the caller lacks. */
export const assertMayCreate =
  (context: MutationContext, resource: ResourceMeta) => {
    if (resource.access.create === 'none')
      throw forbidden(`"${resource.type}" rows are created by the server, not through the API`)
    if (resource.access.create === 'role'
        && (context.userId !== undefined || context.anonymous)
        && !granted(viewerIn(context), resource, 'create'))
      throw forbidden(`Creating "${resource.type}" needs a role that allows it`)
  }

export const createResource =
  async ( context: MutationContext
  , resource: ResourceMeta
  , document: WriteDocument): Promise<string> => {
    assertMayCreate(context, resource)
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

import { SIGNATURE_HEADER } from '../../auth/signing.ts'
import type { BuiltSchema, Operation, TableDef } from '../../db/schema-types.ts'
import { pathParam, type AppContext } from '../context.ts'
import type { Row, RowDatabase } from '../database.ts'
import { notFound } from '../errors.ts'
import type { MutationContext } from '../mutations/index.ts'
import { parseListQuery, type ListQuery } from '../query.ts'
import
  { buildRegistry
  , type Registry
  , type RelationshipMeta
  , type ResourceMeta
  } from '../registry.ts'
import { createReader, readScope, viewerOf, type Scope } from '../scope.ts'
import { readRowsByIds } from '../read.ts'
import { createSerializer, type RowExpander } from '../serialize.ts'
import { insert } from '../sql.ts'
import { uuidToBuffer } from '../uuid.ts'
import type { ApiDocument } from './document.ts'

/** Everything the route handlers share: the database, schema, and request helpers. */
export type Services =
  { db: RowDatabase
  , built: BuiltSchema
  , registry: Registry
  , tables: Map<string, TableDef>
  , contextFor: (c: AppContext) => MutationContext
  , resourceFor: (c: AppContext) => ResourceMeta
  , relationshipFor: (c: AppContext, resource: ResourceMeta) => RelationshipMeta
  , missing: (resource: ResourceMeta, id: string) => Error
  , queryOf: (c: AppContext, resource: ResourceMeta) => ListQuery
  , reading: (c: AppContext, resource: ResourceMeta) => Scope
  /** The read scope of a resource, as a condition on another alias of its view. */
  , readingAs: (c: AppContext, resource: ResourceMeta, alias: string) => Scope
  , serialize:
      (c: AppContext, resource: ResourceMeta, query: ListQuery, data: unknown)
        => Promise<ApiDocument>
  , mutate:
      ( c: AppContext
      , resource: ResourceMeta
      , operation: Operation
      , run: (context: MutationContext) => Promise<string>) => Promise<string>
  }

/**
 * Build the shared helpers for one schema and database.
 *
 * @param built - The built schema.
 * @param db - The row database.
 */
export const createServices =
  (built: BuiltSchema, db: RowDatabase): Services => {
    const registry = buildRegistry(built)
    const tables = new Map(built.orderedTables.map(x => [x.tableName, x]))

    const contextFor =
      (c: AppContext): MutationContext => ({ built, db, registry, ...viewerOf(c) })

    const resourceFor =
      (c: AppContext) => {
        const type = pathParam(c, 'type')
        const resource = registry.get(type)
        if (!resource) throw notFound(`Unknown resource type "${type}"`)
        return resource
      }

    /** Look up the relationship named in the path, or 404. */
    const relationshipFor =
      (c: AppContext, resource: ResourceMeta) => {
        const label = pathParam(c, 'rel')
        const meta = resource.relationships[label]
        if (!meta)
          throw notFound(
            `Unknown relationship "${label}" for resource "${resource.type}"`)
        return meta
      }

    /** Serialize a row or rows using the request's fields and include options. */
    const serialize =
      async (c: AppContext, resource: ResourceMeta, query: ListQuery, data: unknown) => {
        if (data === null) return { data: null }
        const read = createReader(db, viewerOf(c), registry)
        const expand: RowExpander =
          (target, ids, labels) =>
            readRowsByIds(
              db, tables, target, { fields: query.fields, include: labels }, ids
              , readScope(viewerOf(c), target, registry))
        return await createSerializer(
          registry, query.fields, query.includeTree, resource.type, read, expand)(data as Row | Row[])
      }

    const mutate =
      ( c: AppContext
      , resource: ResourceMeta
      , operation: Operation
      /** Run a write and, for audited operations, record it in the same transaction. */
      , run: (context: MutationContext) => Promise<string>) => {
        const audited =
          resource.access.audited.includes(operation) && registry.get('audit_log')
        const work =
          async (tx: RowDatabase) => {
            const id = await run({ ...contextFor(c), db: tx })
            if (audited) {
              const user = viewerOf(c).userId
              await insert(
                tx, 'audit_log'
                , { actor: user ? uuidToBuffer(user) : null
                  , action: operation
                  , resource: resource.type
                  , resource_id: uuidToBuffer(id)
                  , signature:
                      c.get('signed') ? c.req.header(SIGNATURE_HEADER) ?? null : null
                  })
            }
            return id
          }
        return audited && db.transaction ? db.transaction(work) : work(db)
      }

    return (
      { db
      , built
      , registry
      , tables
      , contextFor
      , resourceFor
      , relationshipFor
      , missing:
          (resource, id) =>
            notFound(`Resource "${resource.type}" with id "${id}" was not found`)
      , queryOf:
          (c, resource) =>
            parseListQuery(new URL(c.req.url).searchParams, resource, registry)
      , reading:
          (c, resource) => readScope(viewerOf(c), resource, registry)
      , readingAs:
          (c, resource, alias) => readScope(viewerOf(c), resource, registry, alias)
      , serialize
      , mutate
      })
  }

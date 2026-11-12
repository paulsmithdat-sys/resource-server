import { quote } from '../../db/views.ts'
import { pathParam, type AppContext } from '../context.ts'
import type { Row } from '../database.ts'
import { forbidden } from '../errors.ts'
import { readJson } from '../io.ts'
import { changeRelationship, parseRelationship, readResourceRow } from '../mutations/index.ts'
import { readRow } from '../read.ts'
import type { RelationshipMeta, ResourceMeta } from '../registry.ts'
import { createReader, viewerOf } from '../scope.ts'
import type { Condition } from './crud.ts'
import { JSON_API_VERSION, jsonApi, withLinks } from './document.ts'
import type { Services } from './services.ts'

type Collection =
  (c: AppContext, resource: ResourceMeta, extra?: Condition[]) => Promise<Response>

/**
 * Build the handlers for relationship, related-resource and catalog routes.
 *
 * @param s - The shared services.
 * @param collection - The collection handler, reused for to-many related routes.
 */
export const relationshipHandlers =
  (s: Services, collection: Collection) => {
    const { db, tables, registry } = s

    /** The rows a readable parent links to through a relationship, limited to what the viewer may see. */
    const linkedRows =
      async (c: AppContext, resource: ResourceMeta, meta: RelationshipMeta, linkage: boolean) => {
        const id = pathParam(c, 'id')
        const parent =
          await readResourceRow(db, resource, id, s.reading(c, resource))
        if (!parent) throw s.missing(resource, id)

        const value = parent[meta.label]
        const rows =
          value === null || value === undefined
            ? []
            : ([JSON.parse(String(value))].flat() as Row[]).filter(Boolean)
        // x-link-any relationships (shares, group members) list ids of rows that cannot be read.
        return linkage && meta.linkAny
          ? rows
          : await createReader(db, viewerOf(c), registry)(meta.table, rows)
      }

    /** The JSON:API relationship document (resource linkage plus links). */
    const relationshipDocument =
      async (c: AppContext, resource: ResourceMeta, meta: RelationshipMeta) => {
        const identifiers =
          (await linkedRows(c, resource, meta, true))
            .map(x => ({ type: meta.type, id: String(x.id) }))
        const self =
          `${new URL(c.req.url).origin}/${resource.type}/${pathParam(c, 'id')}`
        return (
          { jsonapi: JSON_API_VERSION
          , links:
              { self: `${self}/relationships/${meta.label}`
              , related: `${self}/${meta.label}`
              }
          , data: meta.cardinality === 'many' ? identifiers : identifiers[0] ?? null
          })
      }

    const getRelationship =
      async (c: AppContext) => {
        const resource = s.resourceFor(c)
        return jsonApi(
          c, await relationshipDocument(c, resource, s.relationshipFor(c, resource)))
      }

    const writeRelationship =
      (how: 'replace' | 'add' | 'remove') =>
        async (c: AppContext) => {
          const resource = s.resourceFor(c)
          const meta = s.relationshipFor(c, resource)
          const id = pathParam(c, 'id')
          if (how !== 'replace' && meta.cardinality === 'one')
            throw forbidden(
              `Relationship "${meta.label}" is to-one; replace it with PATCH`)
          const value = parseRelationship(meta.label, await readJson(c), meta)
          await s.mutate(c, resource, 'update', async context => {
            await changeRelationship(context, resource, id, meta.label, value, how)
            return id
          })

          const readable =
            await readResourceRow(db, resource, id, s.reading(c, resource))
          return readable
            ? jsonApi(c, await relationshipDocument(c, resource, meta))
            : c.body(null, 204)
        }

    const getRelated =
      async (c: AppContext) => {
        const resource = s.resourceFor(c)
        const meta = s.relationshipFor(c, resource)
        const target = registry.get(meta.type)!
        const ids =
          (await linkedRows(c, resource, meta, false)).map(x => String(x.id))

        if (meta.cardinality === 'many')
          return collection(
            c, target
            , [ ids.length === 0
                  ? { sql: '0', params: [] }
                  : { sql:
                        `${quote(target.view)}.\`id\` IN (${ids.map(() => '?').join(', ')})`
                    , params: ids
                    }
              ])

        const query = s.queryOf(c, target)
        const row =
          ids[0] === undefined
            ? undefined
            : await readRow(db, tables, target, query, ids[0], s.reading(c, target))
        return jsonApi(
          c, withLinks(c, await s.serialize(c, target, query, row ?? null)))
      }

    const catalog =
      (c: AppContext) =>
        jsonApi(
          c
          , { jsonapi: JSON_API_VERSION
            , links: { self: c.req.url }
            , meta:
              { resources:
                [...registry.resources.values()].map(resource => (
                  { type: resource.type
                  , attributes: resource.attributes
                  , relationships: Object.keys(resource.relationships)
                  }))
              }
            })

    return { getRelationship, writeRelationship, getRelated, catalog }
  }

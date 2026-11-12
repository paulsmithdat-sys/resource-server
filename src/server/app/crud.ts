import { pathParam, type AppContext } from '../context.ts'
import { readJson } from '../io.ts'
import
  { assertMayCreate
  , createResource
  , deleteResource
  , parseWriteDocument
  , updateResource
  } from '../mutations/index.ts'
import { listRows, readRow } from '../read.ts'
import type { ResourceMeta } from '../registry.ts'
import { jsonApi, pageLinks, withLinks } from './document.ts'
import type { Services } from './services.ts'

/** An extra SQL condition added to a collection query. */
export type Condition = { sql: string, params: unknown[] }

/**
 * Build the handlers for the collection and item routes.
 *
 * @param s - The shared services.
 * @returns The handlers, plus `collection` which the relationship routes reuse.
 */
export const crudHandlers =
  (s: Services) => {
    const { db, tables } = s

    /** Respond with a filtered, sorted, paginated list of a resource. */
    const collection =
      async (c: AppContext, resource: ResourceMeta, extra: Condition[] = []) => {
        const query = s.queryOf(c, resource)
        const { rows, total } =
          await listRows(
            db, tables, resource, query, [s.reading(c, resource), ...extra]
            , (target, alias) => s.readingAs(c, target, alias))

        return jsonApi(
          c
          , withLinks(
              c
              , { ...await s.serialize(c, resource, query, rows)
                , meta:
                    { page:
                      { number: query.pageNumber
                      , size: query.pageSize
                      , total
                      , pages: Math.ceil(total / query.pageSize)
                      }
                    }
                }
              , pageLinks(c, query, total)))
      }

    const list = (c: AppContext) => collection(c, s.resourceFor(c))

    const getOne =
      async (c: AppContext) => {
        const resource = s.resourceFor(c)
        const id = pathParam(c, 'id')
        const query = s.queryOf(c, resource)
        const row =
          await readRow(db, tables, resource, query, id, s.reading(c, resource))
        if (!row) throw s.missing(resource, id)

        return jsonApi(c, withLinks(c, await s.serialize(c, resource, query, row)))
      }

    const create =
      async (c: AppContext) => {
        const resource = s.resourceFor(c)
        const query = s.queryOf(c, resource)
        assertMayCreate(s.contextFor(c), resource)
        const document = parseWriteDocument(resource, await readJson(c))
        const id =
          await s.mutate(
            c, resource, 'create'
            , context => createResource(context, resource, document))

        const row =
          await readRow(db, tables, resource, query, id, { sql: '', params: [] })
        const location = `${new URL(c.req.url).origin}/${resource.type}/${id}`
        return jsonApi(
          c
          , { ...withLinks(c, await s.serialize(c, resource, query, row))
            , links: { self: location }
            }
          , 201
          , { location: `/${resource.type}/${id}` })
      }

    const update =
      (mode: 'patch' | 'put') =>
        async (c: AppContext) => {
          const resource = s.resourceFor(c)
          const id = pathParam(c, 'id')
          const query = s.queryOf(c, resource)
          const document =
            parseWriteDocument(resource, await readJson(c), { id })
          await s.mutate(c, resource, 'update', async context => {
            await updateResource(context, resource, id, document, mode)
            return id
          })

          // A write-only sharer gets no copy of a row they cannot read.
          const row =
            await readRow(db, tables, resource, query, id, s.reading(c, resource))
          return row
            ? jsonApi(c, withLinks(c, await s.serialize(c, resource, query, row)))
            : c.body(null, 204)
        }

    const remove =
      async (c: AppContext) => {
        const resource = s.resourceFor(c)
        const id = pathParam(c, 'id')
        await s.mutate(c, resource, 'delete', async context => {
          await deleteResource(context, resource, id)
          return id
        })
        return c.body(null, 204)
      }

    return { collection, list, getOne, create, update, remove }
  }

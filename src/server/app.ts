import { Hono } from 'hono'
import { ErrorSerializer, JapiError } from 'ts-japi'
import { createAuthService } from '../auth/service.ts'
import { registerAuthRoutes } from '../auth/routes.ts'
import { SIGNATURE_HEADER, verifySignedRequest } from '../auth/signing.ts'
import type { BuiltSchema, Operation } from '../db/schema-types.ts'
import { quote } from '../db/views.ts'
import type { Row, RowDatabase } from './database.ts'
import
  { ApiError
  , forbidden
  , notAcceptable
  , notFound
  , unsupportedMediaType
  } from './errors.ts'
import { readJson } from './io.ts'
import
  { changeRelationship
  , createResource
  , deleteResource
  , parseRelationship
  , parseWriteDocument
  , readResourceRow
  , updateResource
  , type MutationContext
  } from './mutations.ts'
import { parseListQuery, type ListQuery } from './query.ts'
import { listRows, readRow } from './read.ts'
import
  { buildRegistry
  , type RelationshipMeta
  , type ResourceMeta
  } from './registry.ts'
import { createReader, readScope, viewerOf } from './scope.ts'
import { createSerializers } from './serialize.ts'
import { sessionMiddleware } from './session.ts'
import { insert } from './sql.ts'
import { uuidToBuffer } from './uuid.ts'

const JSON_API = 'application/vnd.api+json'
const JSON_API_VERSION = { version: '1.1' }

const errorSerializer = new ErrorSerializer()

export const operationOf =
  (method: string, nested = false): Operation => {
    // Purpose: map an HTTP method to the x-access operation it performs (relationship writes update the parent)
    if (['GET', 'HEAD', 'OPTIONS'].includes(method)) return 'read'
    if (nested || method === 'PUT' || method === 'PATCH') return 'update'
    return method === 'POST' ? 'create' : 'delete'
  }

const jsonApi =
  ( c: any
  , document: unknown
  , status = 200
  , headers: Record<string, string> = {}) =>
    c.body(
      c.req.method === 'HEAD' ? null : JSON.stringify(document)
      , status
      , { 'content-type': JSON_API, ...headers })

const errorDocument =
  (status: number, title: string, detail: string, parameter?: string) =>
    errorSerializer.serialize(
      new JapiError(
        { status
        , title
        , detail
        , ...(parameter ? { source: { parameter } } : {})
        }))

const plainMediaType =
  (value: string) =>
    // Purpose: true when a media type carries no parameters other than ext, profile or q
    value.split(';').slice(1)
      .map(x => x.trim().split('=')[0]!.toLowerCase())
      .every(x => x === '' || x === 'ext' || x === 'profile' || x === 'q')

const negotiate =
  (c: any, nested: boolean, known: boolean) => {
    // Purpose: apply JSON:API content negotiation (406 for Accept, 415 for Content-Type)
    const ours =
      (c.req.header('accept') ?? '')
        .split(',')
        .map((x: string) => x.trim())
        .filter((x: string) => x.toLowerCase().startsWith(JSON_API))
    if (ours.length > 0 && !ours.some(plainMediaType))
      throw notAcceptable(
        `Accept must include ${JSON_API} without media type parameters`)

    const method = c.req.method
    if (known
        && (['POST', 'PUT', 'PATCH'].includes(method)
            || (method === 'DELETE' && nested))) {
      const type = c.req.header('content-type') ?? ''
      if (!type.toLowerCase().startsWith(JSON_API) || !plainMediaType(type))
        throw unsupportedMediaType(`Content-Type must be ${JSON_API}`)
    }
  }

const pageLinks =
  (c: any, query: ListQuery, total: number) => {
    // Purpose: build first/last/prev/next links for a paginated collection
    const pages = Math.max(1, Math.ceil(total / query.pageSize))
    const at = (page: number) => {
      // Purpose: the current URL with another page number
      const url = new URL(c.req.url)
      url.searchParams.set('page[number]', String(page))
      url.searchParams.set('page[size]', String(query.pageSize))
      return url.toString()
    }
    return (
      { first: at(1)
      , last: at(pages)
      , prev: query.pageNumber > 1 ? at(query.pageNumber - 1) : null
      , next: query.pageNumber < pages ? at(query.pageNumber + 1) : null
      })
  }

const withLinks =
  (c: any, document: any, extra: Record<string, unknown> = {}) => {
    // Purpose: add the JSON:API version and self/related links to a document and its resources
    const origin = new URL(c.req.url).origin
    for (const item of [document.data, document.included].flat()) {
      if (!item?.id) continue
      const self = `${origin}/${item.type}/${item.id}`
      item.links = { self }
      for (const [label, relationship] of Object.entries(item.relationships ?? {}))
        (relationship as any).links =
          { self: `${self}/relationships/${label}`, related: `${self}/${label}` }
    }
    // "included" only belongs in a document when the client asked for includes.
    const { included, ...rest } = document
    return (
      { ...rest
      , ...(included?.length > 0 || c.req.query('include') !== undefined
          ? { included: included ?? [] }
          : {})
      , jsonapi: JSON_API_VERSION
      , links: { self: c.req.url, ...extra }
      })
  }

export type AppOptions =
  { built: BuiltSchema
  , db: RowDatabase
  , opaqueServerSetup?: string
  , requireSession?: boolean
  // Usernames that always hold the "admin" role
  , admins?: string[]
  }

export const createApp =
  ({ built, db, opaqueServerSetup, requireSession, admins = [] }: AppOptions) => {
    const registry = buildRegistry(built)
    const tables = new Map(built.orderedTables.map(x => [x.tableName, x]))
    const adminNames = admins.map(x => x.toLowerCase())
    const app = new Hono()

    if (opaqueServerSetup)
      registerAuthRoutes(
        app
        , createAuthService(
            { db
            , serverSetup: opaqueServerSetup
            , audit: registry.get('audit_log') !== undefined
            }))

    const rolesOf =
      async (userId: string) => {
        // Purpose: list the roles a user holds, from user_role plus the configured admins
        if (!registry.get('user_role')) return []
        const user = uuidToBuffer(userId)
        const roles =
          (await db.all('SELECT `role` FROM `user_role` WHERE `user_id` = ?', [user]))
            .map(x => String(x.role))
        if (adminNames.length > 0 && !roles.includes('admin')) {
          const row =
            await db.get(
              'SELECT lower(`username`) AS `name` FROM `user` WHERE `id` = ?', [user])
          if (row && adminNames.includes(String(row.name))) roles.push('admin')
        }
        return roles
      }

    const requireAuth = requireSession ? sessionMiddleware(db) : undefined

    // Every resource request passes through here. x-access read/create "public"
    // allow those operations without a session; a session that is sent is always
    // validated; signed operations need a session and a valid signature.
    const guard =
      async (c: any, next: any) => {
        const nested = c.req.param('rel') !== undefined
        negotiate(c, nested, registry.get(c.req.param('type')) !== undefined)
        if (!requireAuth) return next()

        const access = registry.get(c.req.param('type'))?.access
        const operation = operationOf(c.req.method, nested)
        const signed = access?.signed.includes(operation) === true
        const open =
          !signed
          && ((operation === 'read' && access?.read === 'public')
              || (operation === 'create' && access?.create === 'public'))
        if (open && !c.req.header('authorization')) {
          c.set('anonymous', true)
          return next()
        }
        return requireAuth(c, async () => {
          c.set('signed', await verifySignedRequest(c, db, signed))
          c.set('roles', await rolesOf(c.get('userId')))
          await next()
        })
      }

    const paths =
      { collection: '/:type'
      , item: '/:type/:id'
      , relationship: '/:type/:id/relationships/:rel'
      , related: '/:type/:id/:rel'
      }
    for (const path of Object.values(paths)) app.use(path, guard)

    const contextFor =
      (c: any): MutationContext => (
        { built
        , db
        , registry
        , ...viewerOf(c)
        })

    const resourceFor =
      (c: any) => {
        const type = c.req.param('type')
        const resource = registry.get(type)
        if (!resource) throw notFound(`Unknown resource type "${type}"`)
        return resource
      }

    const relationshipFor =
      (c: any, resource: ResourceMeta) => {
        // Purpose: look up the relationship named in the path, or 404
        const label = c.req.param('rel')
        const meta = resource.relationships[label]
        if (!meta)
          throw notFound(
            `Unknown relationship "${label}" for resource "${resource.type}"`)
        return meta
      }

    const missing =
      (resource: ResourceMeta, id: string) =>
        notFound(`Resource "${resource.type}" with id "${id}" was not found`)

    const queryOf =
      (c: any, resource: ResourceMeta) =>
        parseListQuery(new URL(c.req.url).searchParams, resource, registry)

    const reading =
      (c: any, resource: ResourceMeta) =>
        readScope(viewerOf(c), resource, registry)

    const serialize =
      async (c: any, resource: ResourceMeta, query: ListQuery, data: unknown) => {
        // Purpose: serialize a row or rows using the request's fields and include options
        if (data === null) return { data: null }
        return await createSerializers(
          registry, query.fields, query.include, resource.type
          , createReader(db, viewerOf(c), registry))
          .get(resource.type)!
          .serialize(data as any, { include: query.include })
      }

    const mutate =
      ( c: any
      , resource: ResourceMeta
      , operation: Operation
      , run: (context: MutationContext) => Promise<string>) => {
        // Purpose: run a write and, for audited operations, record it in the same transaction
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

    const collection =
      async ( c: any
      , resource: ResourceMeta
      , extra: { sql: string, params: unknown[] }[] = []) => {
        // Purpose: respond with a filtered, sorted, paginated list of a resource
        const query = queryOf(c, resource)
        const { rows, total } =
          await listRows(
            db, tables, resource, query, [reading(c, resource), ...extra])

        return jsonApi(
          c
          , withLinks(
              c
              , { ...await serialize(c, resource, query, rows)
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

    const list = (c: any) => collection(c, resourceFor(c))

    const getOne =
      async (c: any) => {
        const resource = resourceFor(c)
        const id = c.req.param('id')
        const query = queryOf(c, resource)
        const row =
          await readRow(db, tables, resource, query, id, reading(c, resource))
        if (!row) throw missing(resource, id)

        return jsonApi(c, withLinks(c, await serialize(c, resource, query, row)))
      }

    const create =
      async (c: any) => {
        const resource = resourceFor(c)
        const query = queryOf(c, resource)
        const document = parseWriteDocument(resource, await readJson(c))
        const id =
          await mutate(
            c, resource, 'create'
            , context => createResource(context, resource, document))

        const row =
          await readRow(db, tables, resource, query, id, { sql: '', params: [] })
        const location = `${new URL(c.req.url).origin}/${resource.type}/${id}`
        return jsonApi(
          c
          , { ...withLinks(c, await serialize(c, resource, query, row))
            , links: { self: location }
            }
          , 201
          , { location: `/${resource.type}/${id}` })
      }

    const update =
      (mode: 'patch' | 'put') =>
        async (c: any) => {
          const resource = resourceFor(c)
          const id = c.req.param('id')
          const query = queryOf(c, resource)
          const document =
            parseWriteDocument(resource, await readJson(c), { id })
          await mutate(c, resource, 'update', async context => {
            await updateResource(context, resource, id, document, mode)
            return id
          })

          // A write-only sharer gets no copy of a row they cannot read.
          const row =
            await readRow(db, tables, resource, query, id, reading(c, resource))
          return row
            ? jsonApi(c, withLinks(c, await serialize(c, resource, query, row)))
            : c.body(null, 204)
        }

    const remove =
      async (c: any) => {
        const resource = resourceFor(c)
        const id = c.req.param('id')
        await mutate(c, resource, 'delete', async context => {
          await deleteResource(context, resource, id)
          return id
        })
        return c.body(null, 204)
      }

    const linkedRows =
      async (c: any, resource: ResourceMeta, meta: RelationshipMeta, linkage: boolean) => {
        // Purpose: the rows a readable parent links to through a relationship, limited to what the viewer may see
        const id = c.req.param('id')
        const parent =
          await readResourceRow(db, resource, id, reading(c, resource))
        if (!parent) throw missing(resource, id)

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

    const relationshipDocument =
      async (c: any, resource: ResourceMeta, meta: RelationshipMeta) => {
        // Purpose: the JSON:API relationship document (resource linkage plus links)
        const identifiers =
          (await linkedRows(c, resource, meta, true))
            .map(x => ({ type: meta.type, id: String(x.id) }))
        const self =
          `${new URL(c.req.url).origin}/${resource.type}/${c.req.param('id')}`
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
      async (c: any) => {
        const resource = resourceFor(c)
        return jsonApi(
          c, await relationshipDocument(c, resource, relationshipFor(c, resource)))
      }

    const writeRelationship =
      (how: 'replace' | 'add' | 'remove') =>
        async (c: any) => {
          const resource = resourceFor(c)
          const meta = relationshipFor(c, resource)
          const id = c.req.param('id')
          if (how !== 'replace' && meta.cardinality === 'one')
            throw forbidden(
              `Relationship "${meta.label}" is to-one; replace it with PATCH`)
          const value = parseRelationship(meta.label, await readJson(c), meta)
          await mutate(c, resource, 'update', async context => {
            await changeRelationship(context, resource, id, meta.label, value, how)
            return id
          })

          const readable =
            await readResourceRow(db, resource, id, reading(c, resource))
          return readable
            ? jsonApi(c, await relationshipDocument(c, resource, meta))
            : c.body(null, 204)
        }

    const getRelated =
      async (c: any) => {
        const resource = resourceFor(c)
        const meta = relationshipFor(c, resource)
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

        const query = queryOf(c, target)
        const row =
          ids[0] === undefined
            ? undefined
            : await readRow(db, tables, target, query, ids[0], reading(c, target))
        return jsonApi(
          c, withLinks(c, await serialize(c, target, query, row ?? null)))
      }

    const catalog =
      (c: any) =>
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

    const read = ['GET', 'HEAD']
    app.on(read, '/', catalog)
    app.on(read, paths.collection, list)
    app.post(paths.collection, create)
    app.on(read, paths.item, getOne)
    app.put(paths.item, update('put'))
    app.patch(paths.item, update('patch'))
    app.delete(paths.item, remove)
    app.on(read, paths.relationship, getRelationship)
    app.patch(paths.relationship, writeRelationship('replace'))
    app.post(paths.relationship, writeRelationship('add'))
    app.delete(paths.relationship, writeRelationship('remove'))
    app.on(read, paths.related, getRelated)

    for (const [path, methods] of
      [ ['/', 'GET, HEAD, OPTIONS']
      , [paths.collection, 'GET, HEAD, POST, OPTIONS']
      , [paths.item, 'GET, HEAD, PUT, PATCH, DELETE, OPTIONS']
      , [paths.relationship, 'GET, HEAD, PATCH, POST, DELETE, OPTIONS']
      , [paths.related, 'GET, HEAD, OPTIONS']
      ] as const)
      app.options(path, c => c.body(null, 204, { allow: methods }))

    app.onError((error, c) => {
      if (!(error instanceof ApiError)) console.error(error)

      const apiError =
        error instanceof ApiError
          ? error
          : new ApiError(500, 'Internal Server Error', 'Internal server error')

      return jsonApi(
        c
        , errorDocument(
            apiError.status
            , apiError.title
            , apiError.message
            , apiError.parameter)
        , apiError.status)
    })

    app.notFound(c =>
      jsonApi(c, errorDocument(404, 'Not Found', 'Route not found'), 404))

    return app
  }

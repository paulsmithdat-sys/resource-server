import { Hono } from 'hono'
import { ErrorSerializer, JapiError } from 'ts-japi'
import { createAuthService } from '../auth/service.ts'
import { registerAuthRoutes } from '../auth/routes.ts'
import { sessionMiddleware } from './session.ts'
import type { BuiltSchema } from '../db/schema-types.ts'
import type { RowDatabase } from './database.ts'
import { ApiError, badRequest, notFound } from './errors.ts'
import { readJson } from './io.ts'
import
  { createResource
  , deleteResource
  , parseWriteDocument
  , readResourceRow
  , updateResource
  , type MutationContext
  } from './mutations.ts'
import { parseListQuery, quoteIdentifier } from './query.ts'
import { buildRegistry, type ResourceMeta } from './registry.ts'
import { createSerializers } from './serialize.ts'

const JSON_API = 'application/vnd.api+json'

const errorSerializer = new ErrorSerializer()

const jsonApi =
  ( c: any
  , document: unknown
  , status = 200
  , headers: Record<string, string> = {}) =>
    c.body(
      c.req.method === 'HEAD' ? null : JSON.stringify(document)
      , status
      , { 'content-type': JSON_API, ...headers })

const noContent =
  (c: any, headers: Record<string, string> = {}) =>
    c.body(null, 204, headers)

const whereClause =
  (resource: ResourceMeta, filters: { field: string }[], userId?: string) => {
    const conditions = filters.map(x => `${quoteIdentifier(x.field)} = ?`)
    if (userId) conditions.push(`${quoteIdentifier('owner')} = ?`)
    if (conditions.length === 0) return ''
    return ' WHERE ' + conditions.join(' AND ')
  }

export type AppOptions =
  { built: BuiltSchema
  , db: RowDatabase
  , opaqueServerSetup?: string
  , requireSession?: boolean
  }

export const createApp =
  ({ built, db, opaqueServerSetup, requireSession }: AppOptions) => {
    const registry = buildRegistry(built)
    const context: MutationContext = { built, db }
    const app = new Hono()

    if (opaqueServerSetup)
      registerAuthRoutes(
        app
        , createAuthService({ db, serverSetup: opaqueServerSetup }))

    if (requireSession) {
      const requireAuth = sessionMiddleware(db)
      app.use('/:type', requireAuth)
      app.use('/:type/:id', requireAuth)
    }

    const resourceFor =
      (type: string) => {
        const resource = registry.get(type)
        if (!resource)
          throw notFound(`Unknown resource type "${type}"`)
        return resource
      }

    const queryFor =
      (c: any, resource: ResourceMeta) =>
        parseListQuery(new URL(c.req.url).searchParams, resource, registry)

    const serialize =
      async (c: any, resource: ResourceMeta, row: unknown) => {
        const query = queryFor(c, resource)
        const serializers =
          createSerializers(registry, query.fields, query.include, resource.type)
        const serializer = serializers.get(resource.type)!
        return await serializer.serialize(row as any, { include: query.include })
      }

    const serializeById =
      async (c: any, resource: ResourceMeta, id: string) => {
        const row = await readResourceRow(db, resource, id)
        if (!row)
          throw new Error(
            `Resource "${resource.type}" with id "${id}" disappeared after a write`)
        return await serialize(c, resource, row)
      }

    const catalog =
      (c: any) => {
        const resources =
          [...registry.resources.values()].map(resource => (
            { type: resource.type
            , attributes: resource.attributes
            , relationships: Object.keys(resource.relationships)
            }))
        return jsonApi(c, { meta: { resources } })
      }

    const list =
      async (c: any) => {
        const resource = resourceFor(c.req.param('type'))
        const query = queryFor(c, resource)
        const userId = c.get('userId') as string | undefined
        const where = whereClause(resource, query.filters, userId)
        const filterValues =
          userId
            ? [...query.filters.map(x => x.value), userId]
            : query.filters.map(x => x.value)

        const countRow =
          await db.get(
            `SELECT COUNT(*) AS count FROM ${quoteIdentifier(resource.view)}${where}`
            , filterValues)
        const count = countRow?.count
        const total =
          typeof count === 'number' ? count : Number(count ?? 0)

        const order =
          query.sort.length > 0
            ? query.sort
                .map(x => `${quoteIdentifier(x.field)} ${x.direction.toUpperCase()}`)
                .join(', ')
            : `${quoteIdentifier('id')} ASC`

        const offset = (query.pageNumber - 1) * query.pageSize
        const rows =
          await db.all(
            `SELECT * FROM ${quoteIdentifier(resource.view)}${where}`
            + ` ORDER BY ${order} LIMIT ? OFFSET ?`
            , [...filterValues, query.pageSize, offset])

        const serializers =
          createSerializers(registry, query.fields, query.include, resource.type)
        const serializer = serializers.get(resource.type)!
        const document =
          await serializer.serialize(rows, { include: query.include })

        ;(document as any).meta =
          { page:
            { number: query.pageNumber
            , size: query.pageSize
            , total
            , pages: Math.ceil(total / query.pageSize)
            }
          }

        return jsonApi(c, document)
      }

    const getOne =
      async (c: any) => {
        const resource = resourceFor(c.req.param('type'))
        const id = c.req.param('id')
        const row = await readResourceRow(
          db, resource, id, c.get('userId') as string | undefined)
        if (!row)
          throw notFound(
            `Resource "${resource.type}" with id "${id}" was not found`)

        return jsonApi(c, await serialize(c, resource, row))
      }

    const create =
      async (c: any) => {
        const resource = resourceFor(c.req.param('type'))
        context.userId = c.get('userId') as string | undefined
        const document =
          parseWriteDocument(resource, await readJson(c))
        const id = await createResource(context, resource, document)

        return jsonApi(
          c
          , await serializeById(c, resource, id)
          , 201
          , { location: `/${resource.type}/${id}` })
      }

    const update =
      (mode: 'patch' | 'put') =>
        async (c: any) => {
          const resource = resourceFor(c.req.param('type'))
          const id = c.req.param('id')
          context.userId = c.get('userId') as string | undefined
          const document =
            parseWriteDocument(resource, await readJson(c), { id })
          await updateResource(context, resource, id, document, mode)

          return jsonApi(c, await serializeById(c, resource, id))
        }

    const remove =
      async (c: any) => {
        const resource = resourceFor(c.req.param('type'))
        const id = c.req.param('id')
        context.userId = c.get('userId') as string | undefined
        await deleteResource(context, resource, id)
        return noContent(c)
      }

    const allow =
      (c: any, methods: string[]) =>
        noContent(c, { allow: methods.join(', ') })

    app.on(['GET', 'HEAD'], '/', catalog)
    app.options('/', c => allow(c, ['GET', 'HEAD', 'OPTIONS']))

    app.on(['GET', 'HEAD'], '/:type', list)
    app.post('/:type', create)
    app.options('/:type', c => allow(c, ['GET', 'HEAD', 'POST', 'OPTIONS']))

    app.on(['GET', 'HEAD'], '/:type/:id', getOne)
    app.put('/:type/:id', update('put'))
    app.patch('/:type/:id', update('patch'))
    app.delete('/:type/:id', remove)
    app.options(
      '/:type/:id'
      , c => allow(
          c, ['GET', 'HEAD', 'PUT', 'PATCH', 'DELETE', 'OPTIONS']))

    app.onError((error, c) => {
      if (!(error instanceof ApiError))
        console.error(error)

      const apiError =
        error instanceof ApiError
          ? error
          : new ApiError(500, 'Internal Server Error', 'Internal server error')

      const japiError =
        new JapiError(
          { status: apiError.status
          , title: apiError.title
          , detail: apiError.message
          , ...(apiError.parameter
              ? { source: { parameter: apiError.parameter } }
              : {})
          })

      return jsonApi(c, errorSerializer.serialize(japiError), apiError.status)
    })

    app.notFound(c =>
      jsonApi(
        c
        , errorSerializer.serialize(
            new JapiError(
              { status: 404
              , title: 'Not Found'
              , detail: 'Route not found'
              }))
        , 404))

    return app
  }

import { Hono } from 'hono'
import { ErrorSerializer, JapiError } from 'ts-japi'
import type { BuiltSchema } from '../db/schema-types.ts'
import type { RowDatabase } from './database.ts'
import { ApiError, notFound } from './errors.ts'
import { parseListQuery, quoteIdentifier } from './query.ts'
import { buildRegistry, type ResourceMeta } from './registry.ts'
import { createSerializers } from './serialize.ts'

const JSON_API = 'application/vnd.api+json'

const errorSerializer = new ErrorSerializer()

const jsonApi =
  (c: any, document: unknown, status = 200) =>
    c.body(JSON.stringify(document), status, { 'content-type': JSON_API })

const whereClause =
  (resource: ResourceMeta, filters: { field: string }[]) => {
    if (filters.length === 0) return ''
    return ' WHERE '
      + filters
          .map(x => `${quoteIdentifier(x.field)} = ?`)
          .join(' AND ')
  }

export type AppOptions =
  { built: BuiltSchema
  , db: RowDatabase
  }

export const createApp =
  ({ built, db }: AppOptions) => {
    const registry = buildRegistry(built)
    const app = new Hono()

    app.get('/', c => {
      const resources =
        [...registry.resources.values()].map(resource => (
          { type: resource.type
          , attributes: resource.attributes
          , relationships: Object.keys(resource.relationships)
          }))
      return jsonApi(c, { meta: { resources } })
    })

    app.get('/:type', async c => {
      const type = c.req.param('type')
      const resource = registry.get(type)
      if (!resource)
        throw notFound(`Unknown resource type "${type}"`)

      const query =
        parseListQuery(new URL(c.req.url).searchParams, resource, registry)
      const where = whereClause(resource, query.filters)
      const filterValues = query.filters.map(x => x.value)

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
    })

    app.get('/:type/:id', async c => {
      const type = c.req.param('type')
      const resource = registry.get(type)
      if (!resource)
        throw notFound(`Unknown resource type "${type}"`)

      const query =
        parseListQuery(new URL(c.req.url).searchParams, resource, registry)
      const id = c.req.param('id')
      const row =
        await db.get(
          `SELECT * FROM ${quoteIdentifier(resource.view)}`
          + ` WHERE ${quoteIdentifier('id')} = ? LIMIT 1`
          , [id])

      if (!row)
        throw notFound(`Resource "${type}" with id "${id}" was not found`)

      const serializers =
        createSerializers(registry, query.fields, query.include, resource.type)
      const serializer = serializers.get(resource.type)!
      const document =
        await serializer.serialize(row, { include: query.include })

      return jsonApi(c, document)
    })

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

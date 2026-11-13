import { Hono } from 'hono'
import { registerAuthRoutes } from '../../auth/routes.ts'
import { createAuthService } from '../../auth/service/index.ts'
import type { BuiltSchema } from '../../db/schema-types.ts'
import type { Env } from '../context.ts'
import { pathParam } from '../context.ts'
import type { RowDatabase } from '../database.ts'
import { ApiError } from '../errors.ts'
import type { Registry } from '../registry.ts'
import { sessionMiddleware } from '../session.ts'
import { crudHandlers } from './crud.ts'
import { errorDocument, jsonApi } from './document.ts'
import { createGuard } from './guard.ts'
import { relationshipHandlers } from './relationships.ts'
import { createServices } from './services.ts'

export { operationOf } from './negotiate.ts'

/** Options for {@link createApp}. */
export type AppOptions =
  { built: BuiltSchema
  , db: RowDatabase
  /** Enables the OPAQUE registration and login routes when set. */
  , opaqueServerSetup?: string
  /** Require a valid session on every request that is not `public`. */
  , requireSession?: boolean
  /** Usernames that always hold the "admin" role. */
  , admins?: string[]
  }

const paths =
  { collection: '/:type'
  , item: '/:type/:id'
  , relationship: '/:type/:id/relationships/:rel'
  , related: '/:type/:id/:rel'
  }

/** What each route offers, and only reads on a read-only view. */
const allowed =
  { collection: { read: 'GET, HEAD, OPTIONS', write: 'GET, HEAD, POST, OPTIONS' }
  , item:
      { read: 'GET, HEAD, OPTIONS'
      , write: 'GET, HEAD, PUT, PATCH, DELETE, OPTIONS'
      }
  , relationship:
      { read: 'GET, HEAD, OPTIONS'
      , write: 'GET, HEAD, PATCH, POST, DELETE, OPTIONS'
      }
  , related: { read: 'GET, HEAD, OPTIONS', write: 'GET, HEAD, OPTIONS' }
  } as const

/** The OPTIONS response for one route, reflecting whether the resource is writable. */
const optionsFor =
  (c: AppContext, registry: Registry, route: keyof typeof allowed) => {
    const resource = registry.get(pathParam(c, 'type'))
    const methods =
      resource?.readOnly ? allowed[route].read : allowed[route].write
    return c.body(null, 204, { allow: methods })
  }

/**
 * Build the JSON:API Hono app for a built schema.
 *
 * @param options - The schema, database and security settings.
 * @returns A Hono app serving every exposed resource.
 */
export const createApp =
  ({ built, db, opaqueServerSetup, requireSession, admins = [] }: AppOptions): Hono => {
    const s = createServices(built, db)
    const app = new Hono<Env>()

    if (opaqueServerSetup)
      registerAuthRoutes(
        app
        , createAuthService(
            { db
            , serverSetup: opaqueServerSetup
            , audit: s.registry.get('audit_log') !== undefined
            }))

    const requireAuth = requireSession ? sessionMiddleware(db) : undefined
    const guard =
      createGuard(
        { db
        , registry: s.registry
        , adminNames: admins.map(x => x.toLowerCase())
        , requireAuth
        })
    for (const path of Object.values(paths)) app.use(path, guard)
    if (requireAuth) app.use('/', requireAuth)

    const crud = crudHandlers(s)
    const related = relationshipHandlers(s, crud.collection)
    const read = ['GET', 'HEAD']
    app.on(read, '/', related.catalog)
    app.on(read, paths.collection, crud.list)
    app.post(paths.collection, crud.create)
    app.on(read, paths.item, crud.getOne)
    app.put(paths.item, crud.update('put'))
    app.patch(paths.item, crud.update('patch'))
    app.delete(paths.item, crud.remove)
    app.on(read, paths.relationship, related.getRelationship)
    app.patch(paths.relationship, related.writeRelationship('replace'))
    app.post(paths.relationship, related.writeRelationship('add'))
    app.delete(paths.relationship, related.writeRelationship('remove'))
    app.on(read, paths.related, related.getRelated)

    app.options(paths.collection, c => optionsFor(c, s.registry, 'collection'))
    app.options(paths.item, c => optionsFor(c, s.registry, 'item'))
    app.options(
      paths.relationship, c => optionsFor(c, s.registry, 'relationship'))
    app.options(paths.related, c => optionsFor(c, s.registry, 'related'))
    app.options('/', c => c.body(null, 204, { allow: 'GET, HEAD, OPTIONS' }))

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
        , apiError.status as 400)
    })

    app.notFound(c =>
      jsonApi(c, errorDocument(404, 'Not Found', 'Route not found'), 404))

    // Callers see a plain Hono app; the typed variables are internal to the server
    return app as unknown as Hono
  }

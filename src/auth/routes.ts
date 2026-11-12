import type { Context, Hono } from 'hono'
import type { Env } from '../server/context.ts'
import { getConnInfo } from 'hono/bun'
import { badRequest } from '../server/errors.ts'
import { isObject } from '../server/guard.ts'
import { readJson } from '../server/io.ts'
import type { AuthService } from './service/index.ts'

const clientAddress =
  (c: Context) => {
    // Purpose: identify the calling client by socket address for rate limiting
    try {
      return getConnInfo(c).remote.address ?? 'unknown'
    } catch {
      return 'unknown'
    }
  }

export const registerAuthRoutes =
  (app: Hono<Env>, auth: AuthService) => {
    app.post('/key', async c => {
      const body = await readJson(c)
      if (!isObject(body))
        throw badRequest('Request body must be a JSON object')

      const start =
        new Map(
          [ ['opaque_registration', auth.startRegistration]
          , ['opaque_login_state', auth.startLogin]
          ]).get(String(body.type))
      if (typeof body.type !== 'string')
        throw badRequest('"type" is required and must be a string', 'type')
      if (!start)
        throw badRequest(
          '"type" must be "opaque_registration" or "opaque_login_state"'
          , 'type')

      const result = await start(body, clientAddress(c))
      return c.json(result, 201, { location: `/key/${result.id}` })
    })

    app.options('/key', c => c.body(null, 204, { allow: 'POST, OPTIONS' }))

    app.on(['GET', 'HEAD'], '/key/:id', async c =>
      c.json(await auth.getKey(c.req.param('id'))))

    app.patch('/key/:id', async c =>
      c.json(await auth.finishKey(c.req.param('id'), await readJson(c))))

    app.delete('/key/:id', async c => {
      await auth.deleteKey(c.req.param('id'))
      return c.body(null, 204)
    })

    app.options('/key/:id', c =>
      c.body(null, 204, { allow: 'GET, HEAD, PATCH, DELETE, OPTIONS' }))
  }

import type { Hono } from 'hono'
import { badRequest } from '../server/errors.ts'
import type { AuthService } from './service.ts'

const readJson =
  async (c: any) => {
    try {
      return await c.req.json()
    } catch {
      throw badRequest('Request body must be valid JSON')
    }
  }

const keyType =
  (body: unknown) => {
    if (typeof body !== 'object' || body === null || Array.isArray(body))
      throw badRequest('Request body must be a JSON object')

    const type = (body as Record<string, unknown>).type
    if (typeof type !== 'string')
      throw badRequest('"type" is required and must be a string', 'type')
    return type
  }

const json =
  ( c: any
  , document: unknown
  , status = 200
  , headers: Record<string, string> = {}) =>
    c.json(document, status, headers)

export const registerAuthRoutes =
  (app: Hono, auth: AuthService) => {
    app.post('/key', async c => {
      const body = await readJson(c)
      const type = keyType(body)

      if (type === 'opaque_registration') {
        const result = await auth.startRegistration(body)
        return json(
          c, result, 201, { location: `/key/${result.id}` })
      }

      if (type === 'opaque_login_state') {
        const result = await auth.startLogin(body)
        return json(
          c, result, 201, { location: `/key/${result.id}` })
      }

      throw badRequest(
        '"type" must be "opaque_registration" or "opaque_login_state"'
        , 'type')
    })

    app.options(
      '/key'
      , c => c.body(null, 204, { allow: 'POST, OPTIONS' }))

    app.on(['GET', 'HEAD'], '/key/:id', async c => {
      const result = await auth.getKey(c.req.param('id'))
      return json(c, result)
    })

    app.patch('/key/:id', async c => {
      const body = await readJson(c)
      const result = await auth.finishKey(c.req.param('id'), body)
      return json(c, result)
    })

    app.delete('/key/:id', async c => {
      await auth.deleteKey(c.req.param('id'))
      return c.body(null, 204)
    })

    app.options(
      '/key/:id'
      , c => c.body(
          null
          , 204
          , { allow: 'GET, HEAD, PATCH, DELETE, OPTIONS' }))
  }

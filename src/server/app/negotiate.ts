import { parseAccept, type Accept } from 'hono/utils/accept'
import type { Operation } from '../../db/schema-types.ts'
import type { AppContext } from '../context.ts'
import { notAcceptable, unsupportedMediaType } from '../errors.ts'
import { JSON_API } from './document.ts'

/**
 * Map an HTTP method to the `x-access` operation it performs. Relationship
 * writes update the parent row.
 *
 * @param method - The HTTP method.
 * @param nested - True for a relationship route.
 */
export const operationOf =
  (method: string, nested = false): Operation => {
    if (['GET', 'HEAD', 'OPTIONS'].includes(method)) return 'read'
    if (nested || method === 'PUT' || method === 'PATCH') return 'update'
    return method === 'POST' ? 'create' : 'delete'
  }

/** True when a parsed media type is JSON:API with only allowed parameters. */
const jsonApiMediaType =
  (value: Accept, allowQuality: boolean) => {
    return value.type.toLowerCase() === JSON_API
      && value.q > 0
      && Object.keys(value.params).every(name => {
        const key = name.toLowerCase()
        return key === 'ext' || key === 'profile' || (allowQuality && key === 'q')
      })
  }

/**
 * Apply JSON:API content negotiation: 406 for a bad `Accept`, 415 for a bad
 * `Content-Type` on writes to a known resource.
 *
 * @param nested - True for a relationship route.
 * @param known - True when the path names a known resource type.
 */
export const negotiate =
  (c: AppContext, nested: boolean, known: boolean): void => {
    const ours =
      parseAccept(c.req.header('accept') ?? '')
        .filter(value => value.type.toLowerCase() === JSON_API)
    if (ours.length > 0 && !ours.some(value => jsonApiMediaType(value, true)))
      throw notAcceptable(
        `Accept must include ${JSON_API} without unsupported media type parameters`)

    const method = c.req.method
    if (known
        && (['POST', 'PUT', 'PATCH'].includes(method)
            || (method === 'DELETE' && nested))) {
      const [type] = parseAccept(c.req.header('content-type') ?? '')
      if (!type || !jsonApiMediaType(type, false))
        throw unsupportedMediaType(`Content-Type must be ${JSON_API}`)
    }
  }

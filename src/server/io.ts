import type { Context } from 'hono'
import { badRequest } from './errors.ts'

export const readJson =
  async (c: Context): Promise<unknown> => {
    try {
      return await c.req.json()
    } catch {
      throw badRequest('Request body must be valid JSON')
    }
  }

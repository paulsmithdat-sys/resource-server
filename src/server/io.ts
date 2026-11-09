import { badRequest } from './errors.ts'

export const readJson =
  async (c: any): Promise<unknown> => {
    try {
      return await c.req.json()
    } catch {
      throw badRequest('Request body must be valid JSON')
    }
  }

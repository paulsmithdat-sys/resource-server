import type { Context, Next } from 'hono'

/** Values the middleware stores on the request context for later handlers. */
export type Variables =
  { anonymous?: boolean
  , userId?: string
  , sessionId?: string
  , sessionKey?: Uint8Array
  , clientJwk?: unknown
  , signed?: boolean
  , roles?: string[]
  }

/** The Hono environment used by the resource server. */
export type Env = { Variables: Variables }

/** A request context carrying the typed {@link Variables}. */
export type AppContext = Context<Env>

export type { Next }

/**
 * Read a path parameter that the route pattern guarantees.
 *
 * @param c - The request context.
 * @param name - The parameter name, such as `type` or `id`.
 * @returns The parameter value, or an empty string when absent.
 */
export const pathParam =
  (c: AppContext, name: string): string => {
    return c.req.param(name) ?? ''
  }

import type { ContentfulStatusCode } from 'hono/utils/http-status'
import { ErrorSerializer, JapiError } from 'ts-japi'
import type { AppContext } from '../context.ts'
import type { ListQuery } from '../query.ts'

/** The JSON:API media type. */
export const JSON_API = 'application/vnd.api+json'

/** The `jsonapi` member added to every document. */
export const JSON_API_VERSION = { version: '1.1' }

const errorSerializer = new ErrorSerializer()

type Links = { self?: string, related?: string }

/** A resource object as far as link decoration cares. */
export type ResourceObject =
  { id?: string
  , type: string
  , links?: Links
  , relationships?: Record<string, { links?: Links }>
  }

/** A JSON:API document before links are added. */
export type ApiDocument =
  { data?: ResourceObject | ResourceObject[] | null
  , included?: ResourceObject[]
  , [member: string]: unknown
  }

/**
 * Send a JSON:API document with the right content type.
 *
 * @param c - The request context.
 * @param document - The document to serialize (omitted for HEAD).
 * @param status - The HTTP status, 200 by default.
 * @param headers - Extra response headers.
 */
export const jsonApi =
  ( c: AppContext
  , document: unknown
  , status: ContentfulStatusCode = 200
  /** Respond with a JSON:API document (no body for HEAD). */
  , headers: Record<string, string> = {}): Response => {
    const responseHeaders = { 'content-type': JSON_API, ...headers }
    return c.req.method === 'HEAD'
      ? c.body(null, status, responseHeaders)
      : c.body(JSON.stringify(document), status, responseHeaders)
  }

/**
 * Build a JSON:API error document.
 *
 * @param parameter - The query parameter or attribute pointer at fault, if any.
 */
export const errorDocument =
  (status: number, title: string, detail: string, parameter?: string) => {
    return errorSerializer.serialize(
      new JapiError(
        { status
        , title
        , detail
        , ...(parameter ? { source: { parameter } } : {})
        }))
  }

/**
 * Build first/last/prev/next links for a paginated collection.
 */
export const pageLinks =
  (c: AppContext, query: ListQuery, total: number) => {
    const pages = Math.max(1, Math.ceil(total / query.pageSize))
    /** The current URL with another page number. */
    const at = (page: number) => {
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

/**
 * Add the JSON:API version and self/related links to a document and its
 * resources. `included` is only kept when the client asked for includes.
 */
export const withLinks =
  (c: AppContext, document: ApiDocument, extra: Record<string, unknown> = {}) => {
    const origin = new URL(c.req.url).origin
    for (const item of [document.data, document.included].flat()) {
      if (!item?.id) continue
      const self = `${origin}/${item.type}/${item.id}`
      item.links = { self }
      for (const [label, relationship] of Object.entries(item.relationships ?? {}))
        relationship.links =
          { self: `${self}/relationships/${label}`, related: `${self}/${label}` }
    }
    const { included, ...rest } = document
    return (
      { ...rest
      , ...(included && included.length > 0 || c.req.query('include') !== undefined
          ? { included: included ?? [] }
          : {})
      , jsonapi: JSON_API_VERSION
      , links: { self: c.req.url, ...extra }
      })
  }

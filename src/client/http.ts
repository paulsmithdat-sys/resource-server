import { errorFromResponse } from './errors.ts'

export type FetchLike =
  (input: string | URL | Request, init?: RequestInit) => Promise<Response>

export type HttpOptions =
  { baseUrl?: string
  , fetch?: FetchLike
  }

export type HttpClient =
  { resolve: (path: string) => URL
  , request: (path: string, init?: RequestInit) => Promise<Response>
  , expectOk: (response: Response) => Promise<void>
  , json: <T>(path: string, init?: RequestInit) => Promise<T>
  }

const normalise =
  (baseUrl: string | undefined) =>
    baseUrl ? baseUrl.replace(/\/+$/, '') : ''

/**
 * A small fetch wrapper. `baseUrl` should be an absolute origin, optionally
 * with a path prefix, such as `https://api.example.com` or
 * `https://example.com/api`. Leaving it out makes requests relative to the
 * current origin.
 */
export const createHttp =
  (options: HttpOptions = {}): HttpClient => {
    const base = normalise(options.baseUrl)
    const doFetch: FetchLike =
      options.fetch ?? ((input, init) => fetch(input, init))

    const resolve =
      (path: string) =>
        new URL(
          `${base}${path.startsWith('/') ? path : `/${path}`}`
          , base || 'http://localhost')

    const target =
      (url: URL) => base ? url.toString() : url.pathname + url.search

    const request =
      async (path: string, init: RequestInit = {}) =>
        await doFetch(target(resolve(path)), init)

    const expectOk =
      async (response: Response) => {
        if (!response.ok) throw await errorFromResponse(response)
      }

    const json =
      async <T>(path: string, init: RequestInit = {}) => {
        const response = await request(path, init)
        await expectOk(response)
        if (response.status === 204) return undefined as T
        return await response.json() as T
      }

    return { resolve, request, expectOk, json }
  }

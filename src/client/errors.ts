export type JsonApiError =
  { status?: string
  , title?: string
  , detail?: string
  , source?: { parameter?: string }
  }

/**
 * An error returned by the resource server. Resource calls throw this for every
 * non-2xx response, with the JSON:API error details lifted onto the instance.
 */
export class ResourceServerError extends Error {
  status: number
  title: string
  detail: string
  parameter?: string
  document?: unknown

  constructor(
    status: number
    , title: string
    , detail: string
    , parameter?: string
    , document?: unknown) {
    super(detail)
    this.name = 'ResourceServerError'
    this.status = status
    this.title = title
    this.detail = detail
    this.parameter = parameter
    this.document = document
  }
}

export const errorFromResponse =
  async (response: Response) => {
    let document: unknown
    try {
      document = await response.json()
    } catch {
      document = undefined
    }

    const errors =
      typeof document === 'object' && document !== null
        ? (document as { errors?: unknown }).errors
        : undefined
    const first =
      Array.isArray(errors) ? errors[0] as JsonApiError | undefined : undefined

    return new ResourceServerError(
      response.status
      , first?.title ?? response.statusText ?? 'Request failed'
      , first?.detail ?? `Request failed with status ${response.status}`
      , first?.source?.parameter
      , document)
  }

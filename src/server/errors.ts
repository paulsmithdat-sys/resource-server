export class ApiError extends Error {
  status: number
  title: string
  parameter?: string

  constructor(
    status: number
    , title: string
    , detail: string
    , parameter?: string) {
    super(detail)
    this.name = 'ApiError'
    this.status = status
    this.title = title
    this.parameter = parameter
  }
}

const factory =
  (status: number, title: string) =>
    (detail: string, parameter?: string) =>
      new ApiError(status, title, detail, parameter)

export const badRequest = factory(400, 'Bad Request')
export const unauthorized = factory(401, 'Unauthorized')
export const forbidden = factory(403, 'Forbidden')
export const notFound = factory(404, 'Not Found')
export const methodNotAllowed = factory(405, 'Method Not Allowed')
export const conflict = factory(409, 'Conflict')
export const tooManyRequests = factory(429, 'Too Many Requests')
export const notAcceptable = factory(406, 'Not Acceptable')
export const unsupportedMediaType = factory(415, 'Unsupported Media Type')

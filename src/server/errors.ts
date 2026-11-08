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

export const badRequest =
  (detail: string, parameter?: string) =>
    new ApiError(400, 'Bad Request', detail, parameter)

export const notFound =
  (detail: string) =>
    new ApiError(404, 'Not Found', detail)

export const conflict =
  (detail: string) =>
    new ApiError(409, 'Conflict', detail)

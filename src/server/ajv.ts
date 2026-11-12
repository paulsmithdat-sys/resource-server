import Ajv, { type ErrorObject } from 'ajv'
import addFormats from 'ajv-formats'

/** A compiled AJV validator: call it with data, then read `errors`. */
export type Validator = ((data: unknown) => boolean) & { errors?: ErrorObject[] | null }

export const ajv = (() => {
  const instance = new Ajv({ strict: false })
  addFormats(instance)
  return instance
})()

export const errorField =
  (validator: Validator, fallback: string): string => {
    // Purpose: name the field behind an AJV validator's first error
    const error = validator.errors?.[0]
    if (!error) return fallback

    const path =
      String(error.instancePath ?? '')
        .replace(/^\//, '')
        .replaceAll('/', '.')
    const property =
      error.params?.missingProperty ?? error.params?.additionalProperty
    return [path, property].filter(Boolean).join('.') || fallback
  }

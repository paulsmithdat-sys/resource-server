import Ajv from 'ajv'
import addFormats from 'ajv-formats'

export const ajv = (() => {
  const instance = new Ajv({ strict: false })
  addFormats(instance)
  return instance
})()

export const errorField =
  (validator: unknown, fallback: string): string => {
    // Purpose: name the field behind an AJV validator's first error
    const error = (validator as any).errors?.[0]
    return error?.instancePath?.replace(/^\//, '')
      || error?.params?.missingProperty
      || fallback
  }

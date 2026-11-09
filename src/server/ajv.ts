import Ajv from 'ajv'
import addFormats from 'ajv-formats'

export const ajv = (() => {
  const instance = new Ajv({ strict: false })
  addFormats(instance)
  return instance
})()

import { badRequest } from '../server/errors.ts'
import { isObject } from '../server/guard.ts'
import { ajv, errorField } from '../server/ajv.ts'

type ValidateFn = (data: unknown) => boolean

const compile =
  (schema: unknown): ValidateFn => ajv.compile(schema as Record<string, unknown>)

const registrationStart = compile(
  { type: 'object'
  , additionalProperties: false
  , required: [ 'type', 'username', 'registrationRequest', 'clientPublicKey' ]
  , properties:
    { type: { type: 'string' }
    , username: { type: 'string', minLength: 1, maxLength: 100 }
    , displayName: { type: 'string', maxLength: 100 }
    , registrationRequest: { type: 'string', minLength: 1 }
    , clientPublicKey: { type: 'object' }
    }
  })

const loginStart = compile(
  { type: 'object'
  , additionalProperties: false
  , required: [ 'type', 'username', 'startLoginRequest' ]
  , properties:
    { type: { type: 'string' }
    , username: { type: 'string', minLength: 1, maxLength: 100 }
    , startLoginRequest: { type: 'string', minLength: 1 }
    , clientPublicKey: { type: 'object' }
    }
  })

const registrationFinish = compile(
  { type: 'object'
  , additionalProperties: false
  , required: [ 'registrationRecord' ]
  , properties:
    { registrationRecord: { type: 'string', minLength: 1 } }
  })

const loginFinish = compile(
  { type: 'object'
  , additionalProperties: false
  , required: [ 'finishLoginRequest' ]
  , properties:
    { finishLoginRequest: { type: 'string', minLength: 1 } }
  })

const validate =
  (validator: ValidateFn, body: unknown): Record<string, unknown> => {
    if (!validator(body)) {
      const field = errorField(validator, 'body')
      throw badRequest(`"${field}" is invalid`, field)
    }
    if (!isObject(body)) throw badRequest('Request body must be a JSON object')
    return body as Record<string, unknown>
  }

export { validate, registrationStart, loginStart, registrationFinish, loginFinish }

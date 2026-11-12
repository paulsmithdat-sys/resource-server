import { badRequest } from '../errors.ts'
import { isObject } from '../guard.ts'
import { ajv, errorField } from '../ajv.ts'
import type { ResourceMeta, RelationshipMeta } from '../registry.ts'
import { UUID_PATTERN } from '../uuid.ts'
import { type WriteDocument, type AttributeValidator } from './types.ts'

const attributeValidators =
  new WeakMap<ResourceMeta, AttributeValidator>()

const buildAttributeValidator =
  (resource: ResourceMeta): AttributeValidator => {
    const cached = attributeValidators.get(resource)
    if (cached) return cached

    // Compile the column schemas themselves so every keyword the author wrote
    // (pattern, minimum, nested properties, items, ...) is enforced. Required
    // attributes stay mode-aware: create/put check them in the write path,
    // while patch may omit them.
    const writable = new Set(writableAttributes(resource))
    const properties =
      Object.fromEntries(
        resource.definition.columns
          .filter(column => writable.has(column.columnName))
          .map(column => [column.columnName, column.schema]))

    const validator =
      ajv.compile(
        { type: 'object'
        , additionalProperties: false
        , properties
        })

    attributeValidators.set(resource, validator)
    return validator
  }

const identifier =
  ( value: unknown
  , label: string
  , expectedType: string) => {
    if (!isObject(value)
        || value.type !== expectedType
        || typeof value.id !== 'string'
        || !UUID_PATTERN.test(value.id))
      throw badRequest(
        `Relationship "${label}" must contain "${expectedType}" identifiers`
        , `relationships.${label}`)

    return value.id.toLowerCase()
  }

export const parseRelationship =
  ( label: string
  , value: unknown
  , meta: RelationshipMeta): string | null | string[] => {
    if (!isObject(value) || !Object.hasOwn(value, 'data'))
      throw badRequest(
        `Relationship "${label}" must contain "data"`, `relationships.${label}`)

    if (meta.cardinality === 'one')
      return value.data === null
        ? null
        : identifier(value.data, label, meta.type)

    if (!Array.isArray(value.data))
      throw badRequest(
        `Relationship "${label}" must contain an array of identifiers`
        , `relationships.${label}`)

    return [...new Set(value.data.map(x => identifier(x, label, meta.type)))]
  }

export const parseWriteDocument =
  ( resource: ResourceMeta
  , body: unknown
  , options: { id?: string } = {}): WriteDocument => {
    if (!isObject(body) || !isObject(body.data))
      throw badRequest('Request body must contain a JSON:API "data" object')

    const data = body.data
    if (data.type !== resource.type)
      throw badRequest(
        `Resource type must be "${resource.type}"`, 'data.type')

    let id: string | undefined
    if (data.id !== undefined) {
      if (typeof data.id !== 'string' || !UUID_PATTERN.test(data.id))
        throw badRequest('Resource id must be a canonical UUID', 'data.id')
      id = data.id.toLowerCase()
    }

    if (options.id !== undefined
        && id !== undefined
        && id !== options.id.toLowerCase())
      throw badRequest(
        'Resource id does not match the request path', 'data.id')

    const rawAttributes = data.attributes ?? {}
    if (!isObject(rawAttributes))
      throw badRequest('Attributes must be an object', 'data.attributes')

    const writable = new Set(writableAttributes(resource))
    const attributes: Record<string, unknown> = {}
    for (const [name, value] of Object.entries(rawAttributes)) {
      if (!writable.has(name))
        throw badRequest(
          resource.attributes.includes(name)
            ? `Attribute "${name}" is read-only`
            : `Unknown attribute "${name}" for resource "${resource.type}"`
          , `data.attributes.${name}`)
      attributes[name] = value
    }

    const validateAttributes = buildAttributeValidator(resource)
    if (!validateAttributes(attributes)) {
      const field = errorField(validateAttributes, 'data.attributes')
      throw badRequest(
        `Attribute "${field}" is invalid`
        , `data.attributes.${field}`)
    }

    const rawRelationships = data.relationships ?? {}
    if (!isObject(rawRelationships))
      throw badRequest('Relationships must be an object', 'data.relationships')

    const relationships =
      new Map<string, string | null | string[]>()
    for (const [label, value] of Object.entries(rawRelationships)) {
      const meta = resource.relationships[label]
      if (!meta)
        throw badRequest(
          `Unknown relationship "${label}" for resource "${resource.type}"`
          , `data.relationships.${label}`)
      relationships.set(label, parseRelationship(label, value, meta))
    }

    return (
      { ...(id ? { id } : {})
      , attributes
      , relationships
      })
  }

/** The attributes a client may write: not updated_at and nothing marked readOnly. */
export const writableAttributes =
  (resource: ResourceMeta) => {
    const readOnly =
      new Set(
        resource.definition.columns
          .filter(x => x.schema.readOnly === true)
          .map(x => x.columnName))
    return resource.attributes.filter(x => x !== 'updated_at' && !readOnly.has(x))
  }

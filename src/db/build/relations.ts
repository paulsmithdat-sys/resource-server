import { foreignKey, index, unique } from 'drizzle-orm/sqlite-core'
import { snakeCase, type JSONSchema, type RelationConfig } from '../schema-types.ts'

const relationFieldTypes =
  { column: 'string'
  , foreignKey: 'string'
  , through: 'string'
  , required: 'boolean'
  , 'x-exposed': 'boolean'
  , 'x-link-any': 'boolean'
  } as const

export const validateRelation =
  (sourceTitle: string, label: string, relation: RelationConfig) => {
    const fail =
      (message: string) =>
        new Error(`${sourceTitle}: relation "${label}" ${message}`)

    if (!relation || typeof relation !== 'object')
      throw new Error(`${sourceTitle}: relation "${label}" must be an object`)
    if (typeof relation.table !== 'string' || relation.table.length === 0)
      throw fail('needs a table')
    if (relation.cardinality !== 'one' && relation.cardinality !== 'many')
      throw fail('cardinality must be "one" or "many"')

    for (const [field, type] of Object.entries(relationFieldTypes))
      if ((relation as Record<string, unknown>)[field] !== undefined
          && typeof (relation as Record<string, unknown>)[field] !== type)
        throw fail(`${field} must be a ${type}`)
  }

export const foreignKeyColumnOf =
  (relation: RelationConfig) =>
    snakeCase(relation.foreignKey ?? `${relation.table}_${relation.column ?? 'id'}`)

export const buildUniqueConstraints =
  (schema: JSONSchema, columnNames: Set<string>) => {
    const raw = schema['x-unique-constraints']
    if (raw === undefined) return []

    if (!Array.isArray(raw))
      throw new Error(`${schema.title}: x-unique-constraints must be an array`)

    const result: string[][] = []
    const seen = new Set<string>()

    raw.forEach((entry, index) => {
      if (!Array.isArray(entry) || entry.length === 0
          || !entry.every(x => typeof x === 'string'))
        throw new Error(
          `${schema.title}: x-unique-constraints[${index}] must be a non-empty array of column names`)

      const columns = entry.map(snakeCase)
      for (const column of columns)
        if (!columnNames.has(column))
          throw new Error(
            `${schema.title}: unique constraint references unknown column "${column}"`)

      const signature = columns.join('::')
      if (seen.has(signature)) return
      seen.add(signature)
      result.push(columns)
    })

    return result
  }

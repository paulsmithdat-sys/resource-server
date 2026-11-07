import
  { pascalCase
  , snakeCase
  , type JSONSchema
  , type JSONSchemaProperty
  , type LoadedSchema
  , type RelationConfig
  } from './schema-types.ts'

export const DERIVED_SOURCE = '[derived]'
const DEFAULT_ID = 'id'
const DEFAULT_UPDATED_AT = 'updated_at'

const tableNameOf =
  (schema: JSONSchema) => snakeCase(schema.title)

const titleFromTableName =
  (tableName: string) =>
    tableName
      .split('_')
      .filter(Boolean)
      .map(x => x[0]!.toUpperCase() + x.slice(1))
      .join(' ')

const defaultColumnProperty =
  (columnName: string): JSONSchemaProperty => {
    if (columnName === DEFAULT_ID)
      return { type: 'string', format: 'uuid' }
    if (columnName === DEFAULT_UPDATED_AT)
      return { type: 'string', format: 'date-time' }
    throw new Error(`Unknown default column "${columnName}"`)
  }

const findProperty =
  (schema: JSONSchema, columnName: string) => {
    const normalized = snakeCase(columnName)
    return Object.entries(schema.properties ?? {})
      .find(([key]) => snakeCase(key) === normalized)
  }

const resolveTargetProperty =
  (targetSchema: JSONSchema, targetTable: string, columnName: string) => {
    const normalized = snakeCase(columnName)
    const found = findProperty(targetSchema, normalized)
    if (found) return { key: found[0], property: found[1] }
    if (normalized === DEFAULT_ID || normalized === DEFAULT_UPDATED_AT)
      return { key: normalized, property: defaultColumnProperty(normalized) }
    throw new Error(
      `${targetSchema.title}: relation target column "${targetTable}.${normalized}" does not exist`)
  }

const foreignKeyProperty =
  (targetTable: string, targetColumn: string, target: JSONSchemaProperty): JSONSchemaProperty => (
    { description: `Foreign key to ${targetTable}.${targetColumn}`
    , type: target.type ?? 'string'
    , ...(target.format ? { format: target.format } : {})
    , ...(target.enum ? { enum: target.enum } : {})
    })

const validateRelation =
  (sourceTitle: string, label: string, relation: RelationConfig) => {
    if (!relation || typeof relation !== 'object')
      throw new Error(`${sourceTitle}: relation "${label}" must be an object`)
    if (typeof relation.table !== 'string' || relation.table.length === 0)
      throw new Error(`${sourceTitle}: relation "${label}" needs a table`)
    if (relation.cardinality !== 'one' && relation.cardinality !== 'many')
      throw new Error(`${sourceTitle}: relation "${label}" cardinality must be "one" or "many"`)
    if (relation.column !== undefined && typeof relation.column !== 'string')
      throw new Error(`${sourceTitle}: relation "${label}" column must be a string`)
    if (relation.foreignKey !== undefined && typeof relation.foreignKey !== 'string')
      throw new Error(`${sourceTitle}: relation "${label}" foreignKey must be a string`)
    if (relation.through !== undefined && typeof relation.through !== 'string')
      throw new Error(`${sourceTitle}: relation "${label}" through must be a string`)
    if (relation.required !== undefined && typeof relation.required !== 'boolean')
      throw new Error(`${sourceTitle}: relation "${label}" required must be a boolean`)
  }

const hasInverseOne =
  (targetSchema: JSONSchema, sourceTable: string) =>
    Object.values(targetSchema['x-relations'] ?? {})
      .some(x => x.cardinality === 'one' && x.table === sourceTable)

type JoinCandidate =
  { pair: [string, string]
  , explicitThrough: Set<string>
  }

const deriveJoinTable =
  ( pair: [string, string]
  , through: string
  , schemas: Map<string, LoadedSchema>
  ): LoadedSchema => {
    const [leftTable, rightTable] = pair
    if (leftTable === rightTable)
      throw new Error(
        `Self-referential many-to-many relation "${leftTable}" is not supported yet`)

    const leftSchema = schemas.get(leftTable)!.schema
    const rightSchema = schemas.get(rightTable)!.schema
    const leftColumn = `${leftTable}_id`
    const rightColumn = `${rightTable}_id`
    const leftTarget = resolveTargetProperty(leftSchema, leftTable, DEFAULT_ID)
    const rightTarget = resolveTargetProperty(rightSchema, rightTable, DEFAULT_ID)

    const schema: JSONSchema =
      { $schema: 'https://json-schema.org/draft/2020-12/schema'
      , title: titleFromTableName(through)
      , type: 'object'
      , additionalProperties: false
      , description: `Join table between ${leftTable} and ${rightTable}`
      , properties:
        { [leftColumn]: foreignKeyProperty(leftTable, DEFAULT_ID, leftTarget.property)
        , [rightColumn]: foreignKeyProperty(rightTable, DEFAULT_ID, rightTarget.property)
        }
      , required: [leftColumn, rightColumn]
      , 'x-relations':
        { [leftTable]:
          { table: leftTable
          , column: DEFAULT_ID
          , cardinality: 'one'
          , foreignKey: leftColumn
          , required: true
          }
        , [rightTable]:
          { table: rightTable
          , column: DEFAULT_ID
          , cardinality: 'one'
          , foreignKey: rightColumn
          , required: true
          }
        }
      , 'x-unique-constraints': [[leftColumn, rightColumn]]
      }

    return (
      { schema
      , source: DERIVED_SOURCE
      , importPath: DERIVED_SOURCE
      , exportName: `${pascalCase(schema.title)}Schema`
      })
  }

export const deriveSchemas =
  (base: LoadedSchema[]): LoadedSchema[] => {
    const cloned =
      base.map(x => ({ ...x, schema: structuredClone(x.schema) }))

    const schemas = new Map<string, LoadedSchema>()
    for (const entry of cloned) {
      const tableName = tableNameOf(entry.schema)
      if (schemas.has(tableName))
        throw new Error(`Duplicate table name "${tableName}"`)
      schemas.set(tableName, entry)
    }

    for (const entry of cloned) {
      const schema = entry.schema
      const relations = schema['x-relations'] ?? {}

      for (const [label, relation] of Object.entries(relations)) {
        validateRelation(schema.title, label, relation)
        relation.table = snakeCase(relation.table)

        const target = schemas.get(relation.table)
        if (!target)
          throw new Error(
            `${schema.title}: relation "${label}" targets unknown table "${relation.table}"`)

        relation.column = snakeCase(relation.column ?? DEFAULT_ID)
        const targetProperty =
          resolveTargetProperty(target.schema, relation.table, relation.column)

        if (relation.cardinality === 'one') {
          const foreignKey = snakeCase(
            relation.foreignKey ?? `${relation.table}_${relation.column}`)
          relation.foreignKey = foreignKey

          const existing = findProperty(schema, foreignKey)
          if (!existing) {
            schema.properties =
              { ...(schema.properties ?? {})
              , [foreignKey]:
                  foreignKeyProperty(
                    relation.table, relation.column, targetProperty.property)
              }
          }

          if (relation.required) {
            const required = new Set(schema.required ?? [])
            required.add(existing?.[0] ?? foreignKey)
            schema.required = [...required]
          }
        }
        else if (relation.through)
          relation.through = snakeCase(relation.through)
      }
    }

    const candidates = new Map<string, JoinCandidate>()
    for (const entry of cloned) {
      const sourceTable = tableNameOf(entry.schema)

      for (const relation of Object.values(entry.schema['x-relations'] ?? {})) {
        if (relation.cardinality !== 'many') continue

        const target = schemas.get(relation.table)
        if (!target)
          throw new Error(
            `${entry.schema.title}: relation targets unknown table "${relation.table}"`)

        if (hasInverseOne(target.schema, sourceTable)) continue

        const pair =
          [sourceTable, relation.table].sort() as [string, string]
        const key = pair.join('::')
        let candidate = candidates.get(key)
        if (!candidate) {
          candidate = { pair, explicitThrough: new Set() }
          candidates.set(key, candidate)
        }
        if (relation.through) candidate.explicitThrough.add(relation.through)
      }
    }

    const derived: LoadedSchema[] = []
    const usedNames = new Set(schemas.keys())

    for (const candidate of [...candidates.values()].sort(
      (a, b) => a.pair.join('::').localeCompare(b.pair.join('::')))) {
      if (candidate.explicitThrough.size > 1)
        throw new Error(
          `Conflicting join table names for ${candidate.pair.join(' and ')}: `
          + [...candidate.explicitThrough].join(', '))

      const through =
        [...candidate.explicitThrough][0]
        ?? `${candidate.pair[0]}_${candidate.pair[1]}`

      if (usedNames.has(through))
        throw new Error(`Join table name "${through}" is already in use`)
      usedNames.add(through)

      for (const entry of cloned) {
        const sourceTable = tableNameOf(entry.schema)
        for (const relation of Object.values(entry.schema['x-relations'] ?? {})) {
          if (relation.cardinality !== 'many') continue
          const relationPair =
            [sourceTable, relation.table].sort().join('::')
          if (relationPair !== candidate.pair.join('::')) continue
          const target = schemas.get(relation.table)
          if (target && hasInverseOne(target.schema, sourceTable)) continue
          relation.through = through
        }
      }

      derived.push(deriveJoinTable(candidate.pair, through, schemas))
    }

    return [...cloned, ...derived]
  }

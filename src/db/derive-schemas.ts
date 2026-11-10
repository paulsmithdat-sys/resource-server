import
  { pascalCase
  , snakeCase
  , type JSONSchema
  , type JSONSchemaProperty
  , type LoadedSchema
  , type RelationConfig
  } from './schema-types.ts'

import { normalizeAccess } from './access.ts'

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

const optionalRelationFields: [string, string][] =
  [ ['column', 'string']
  , ['foreignKey', 'string']
  , ['through', 'string']
  , ['required', 'boolean']
  , ['x-exposed', 'boolean']
  ]

const validateRelation =
  (sourceTitle: string, label: string, relation: RelationConfig) => {
    // Purpose: reject relation configs whose fields have the wrong shape
    const fail = (message: string): never => {
      throw new Error(`${sourceTitle}: relation "${label}" ${message}`)
    }
    if (!relation || typeof relation !== 'object') fail('must be an object')
    if (typeof relation.table !== 'string' || relation.table.length === 0)
      fail('needs a table')
    if (relation.cardinality !== 'one' && relation.cardinality !== 'many')
      fail('cardinality must be "one" or "many"')
    for (const [field, type] of optionalRelationFields) {
      const value = (relation as any)[field]
      if (value !== undefined && typeof value !== type)
        fail(`${field} must be a ${type}`)
    }
  }

const hasInverseOne =
  (targetSchema: JSONSchema, sourceTable: string) =>
    Object.values(targetSchema['x-relations'] ?? {})
      .some(x => x.cardinality === 'one' && x.table === sourceTable)

type JoinCandidate =
  { pair: [string, string]
  , label: string
  , explicitThrough: Set<string>
  }

const deriveJoinTable =
  ( pair: [string, string]
  , through: string
  , schemas: Map<string, LoadedSchema>
  ): LoadedSchema => {
    const [leftTable, rightTable] = pair
    // A self-referential pair needs distinct names for its two sides
    const selfReferential = leftTable === rightTable
    const rightName = selfReferential ? `related_${rightTable}` : rightTable

    const leftSchema = schemas.get(leftTable)!.schema
    const rightSchema = schemas.get(rightTable)!.schema
    const leftColumn = `${leftTable}_id`
    const rightColumn = `${rightName}_id`
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
        , [rightName]:
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

const deriveShareTable =
  (source: JSONSchema): LoadedSchema => {
    // Purpose: build the <table>_share schema granting read/write on rows to users or groups
    const table = tableNameOf(source)
    if (table === 'user' || table === 'user_group')
      throw new Error(`${source.title}: system tables cannot be shareable`)
    const access = normalizeAccess(source)
    const writes = (list: string[]) => list.filter(x => x !== 'read')
    const target = (name: string, required = false): RelationConfig =>
      // Purpose: a cascading one-relation from the share row to its note, user or group
      ({ table: name
      , column: DEFAULT_ID
      , cardinality: 'one'
      , foreignKey: `${name}_id`
      , onDelete: 'cascade'
      , ...(required ? { required } : { 'x-link-any': true })
      })

    const schema: JSONSchema =
      { $schema: 'https://json-schema.org/draft/2020-12/schema'
      , title: `${source.title} Share`
      , type: 'object'
      , additionalProperties: false
      , description: `Read/write grants on ${table} rows for users or groups`
      , properties:
        { can_read: { type: 'boolean', default: true }
        , can_write: { type: 'boolean', default: false }
        }
      , 'x-relations':
        { [table]: target(table, true)
        , user: target('user')
        , user_group: target('user_group')
        }
      , 'x-unique-constraints':
          [[`${table}_id`, 'user_id'], [`${table}_id`, 'user_group_id']]
      , 'x-checks':
          [ '(`user_id` IS NULL) <> (`user_group_id` IS NULL)'
          , '`can_read` OR `can_write`'
          ]
      , 'x-access':
        { visibility: ['private']
        , signed: writes(access.signed)
        , audited: writes(access.audited)
        }
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
    const copies =
      base.map(x => ({ ...x, schema: structuredClone(x.schema) }))
    const cloned =
      [ ...copies
      , ...copies
          .filter(x => normalizeAccess(x.schema).shareable)
          .map(x => deriveShareTable(x.schema))
      ]

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

    // Purpose: list every many-relation that needs a join table, with its table pair
    const joined =
      cloned.flatMap(entry => {
        const sourceTable = tableNameOf(entry.schema)
        return Object.entries(entry.schema['x-relations'] ?? {})
          .filter(([, x]) => x.cardinality === 'many'
            && !hasInverseOne(schemas.get(x.table)!.schema, sourceTable))
          .map(([label, relation]) => {
            const pair = [sourceTable, relation.table].sort() as [string, string]
            // Each self-referential relation owns its join table, keyed by label
            const key =
              pair[0] === pair[1] ? `${pair.join('::')}::${label}` : pair.join('::')
            return { relation, pair, label, key }
          })
      })

    const candidates = new Map<string, JoinCandidate>()
    for (const { relation, pair, label, key } of joined) {
      const candidate =
        candidates.get(key) ?? { pair, label, explicitThrough: new Set() }
      candidates.set(key, candidate)
      if (relation.through) candidate.explicitThrough.add(relation.through)
    }

    const derived: LoadedSchema[] = []
    const usedNames = new Set(schemas.keys())

    for (const [key, candidate] of [...candidates].sort(([a], [b]) => a.localeCompare(b))) {
      if (candidate.explicitThrough.size > 1)
        throw new Error(
          `Conflicting join table names for ${candidate.pair.join(' and ')}: `
          + [...candidate.explicitThrough].join(', '))

      const through =
        [...candidate.explicitThrough][0]
        ?? (candidate.pair[0] === candidate.pair[1]
          ? `${candidate.pair[0]}_${snakeCase(candidate.label)}`
          : `${candidate.pair[0]}_${candidate.pair[1]}`)

      if (usedNames.has(through))
        throw new Error(`Join table name "${through}" is already in use`)
      usedNames.add(through)

      for (const x of joined)
        if (x.key === key) x.relation.through = through

      derived.push(deriveJoinTable(candidate.pair, through, schemas))
    }

    return [...cloned, ...derived]
  }

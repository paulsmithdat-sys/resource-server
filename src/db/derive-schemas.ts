import { snakeCase, type LoadedSchema } from './schema-types.ts'
import { normalizeAccess } from './access.ts'
import { DEFAULT_ID, tableNameOf, findProperty, resolveTargetProperty, foreignKeyProperty, validateRelation, hasInverseOne } from './derive/helpers.ts'
import { type JoinCandidate, deriveJoinTable } from './derive/join.ts'
import { deriveShareTable, normalizePropertyTypes } from './derive/share.ts'

export { DERIVED_SOURCE } from './derive/helpers.ts'

export const deriveSchemas =
  (base: LoadedSchema[]): LoadedSchema[] => {
    const copies =
      base.map(x => ({ ...x, schema: structuredClone(x.schema) }))

    // Purpose: normalize before any derivation so foreign keys and share
    // tables inherit plain type strings too
    for (const entry of copies)
      for (const [key, property] of Object.entries(entry.schema.properties ?? {}))
        normalizePropertyTypes(entry.schema.title, property, key)

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

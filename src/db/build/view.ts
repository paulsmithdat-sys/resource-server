import { normalizeAccess } from '../access.ts'
import { normalizePropertyTypes } from '../derive/share.ts'
import
  { pascalCase
  , snakeCase
  , type ColumnDef
  , type JSONSchema
  , type LoadedSchema
  , type RelationConfig
  , type TableDef
  , type ViewDef
  } from '../schema-types.ts'
import
  { foreignKeyColumnOf
  , joinForeignKeys
  , jsonObject
  , jsonValue
  , quote
  , reference
  , viewValue
  } from '../views.ts'
import { buildColumn, validateExposure } from './columns.ts'

type Hop =
  { table: TableDef
  , relation: RelationConfig
  , target: TableDef
  , join?: TableDef
  }

type ColumnSource =
  { kind: 'column'
  , hops: Hop[]
  , column: ColumnDef
  }

type RelationSource =
  { kind: 'relation'
  , table: TableDef
  , target: TableDef
  , hops: Hop[]
  , relation: RelationConfig
  }

type Source = ColumnSource | RelationSource

const need =
  (map: Map<string, TableDef>, name: string, message: string): TableDef => {
    const found = map.get(name)
    if (!found) throw new Error(message)
    return found
  }

const findRelation =
  (table: TableDef, name: string) => {
    const normalized = snakeCase(name)
    return Object.entries(table.relations)
      .find(([label]) => label === name || snakeCase(label) === normalized)?.[1]
  }

/** Resolve the join table of a relation that has one, so SQL generation can find its keys. */
const hopOf =
  ( title: string
  , key: string
  , table: TableDef
  , relation: RelationConfig
  , tablesByName: Map<string, TableDef>): Hop => {
    const target =
      need(tablesByName, relation.table,
        `${title}: property "${key}" relation targets unknown table "${relation.table}"`)
    if (!target.exposed)
      throw new Error(
        `${title}: property "${key}" relation targets hidden table "${relation.table}"`)

    if (!relation.through) return { table, relation, target }

    const join =
      need(tablesByName, relation.through,
        `${title}: property "${key}" join table "${relation.through}" does not exist`)
    if (!join.exposed)
      throw new Error(
        `${title}: property "${key}" join table "${relation.through}" is hidden`)
    return { table, relation, target, join }
  }

/** Resolve an `x-source` path such as `article.author.name` against the base table. */
const resolveSource =
  ( title: string
  , key: string
  , base: TableDef
  , path: string
  , tablesByName: Map<string, TableDef>): Source => {
    const segments = path.split('.')
    if (segments.length < 2 || snakeCase(segments[0]!) !== base.tableName)
      throw new Error(
        `${title}: property "${key}" x-source must start with "${base.tableName}."`)

    let table = base
    const hops: Hop[] = []

    for (let index = 1; index < segments.length; index++) {
      const name = segments[index]!
      const last = index === segments.length - 1
      const column =
        last
          ? table.columns.find(x => x.columnName === snakeCase(name))
          : undefined
      if (column) {
        if (!column.exposed)
          throw new Error(
            `${title}: property "${key}" x-source names hidden column `
            + `"${table.tableName}.${column.columnName}"`)
        return { kind: 'column', hops, column }
      }

      const relation = findRelation(table, name)
      if (!relation)
        throw new Error(
          `${title}: property "${key}" x-source names unknown `
          + `${last ? 'column or relation' : 'relation'} `
          + `"${name}" on "${table.tableName}"`)
      if (relation.exposed === false)
        throw new Error(
          `${title}: property "${key}" x-source names hidden relation `
          + `"${name}" on "${table.tableName}"`)

      const hop = hopOf(title, key, table, relation, tablesByName)
      if (last)
        return (
          { kind: 'relation'
          , table
          , target: hop.target
          , hops
          , relation
          })
      hops.push(hop)
      table = hop.target
    }

    throw new Error(`${title}: property "${key}" x-source is invalid`)
  }

const wrapHop =
  ( hop: Hop
  , parentAlias: string
  , targetAlias: string
  , joinAlias: string
  , inner: string) => {
    const relation = hop.relation
    const from = quote(hop.target.tableName)
    const into = `FROM ${from} AS ${quote(targetAlias)}`

    if (relation.cardinality === 'one')
      return `(SELECT ${inner} ${into}`
        + ` WHERE ${reference(targetAlias, relation.column ?? 'id')}`
        + ` = ${reference(parentAlias, foreignKeyColumnOf(relation))}`
        + ' LIMIT 1)'

    if (relation.through) {
      const join = hop.join
      if (!join)
        throw new Error(
          `${hop.table.tableName}: join table "${relation.through}" does not exist`)
      const keys =
        joinForeignKeys(join, hop.table.tableName, hop.target.tableName)
      if (!keys.source || !keys.target)
        throw new Error(
          `${hop.table.tableName}: join table "${relation.through}" needs `
          + 'foreign keys to both tables')

      return `(SELECT coalesce(json_group_array(${inner}), json('[]')) ${into}`
        + ` JOIN ${quote(relation.through)} AS ${quote(joinAlias)}`
        + ` ON ${reference(joinAlias, keys.target.columns[0]!)}`
        + ` = ${reference(targetAlias, keys.target.foreignColumns[0]!)}`
        + ` WHERE ${reference(joinAlias, keys.source.columns[0]!)}`
        + ` = ${reference(parentAlias, keys.source.foreignColumns[0]!)})`
    }

    const inverse =
      Object.values(hop.target.relations)
        .find(
          x => x.cardinality === 'one' && x.table === hop.table.tableName)
    if (!inverse)
      throw new Error(
        `${hop.table.tableName}: many relation to "${hop.target.tableName}" `
        + 'needs a join table or an inverse one relation')

    return `(SELECT coalesce(json_group_array(${inner}), json('[]')) ${into}`
      + ` WHERE ${reference(targetAlias, foreignKeyColumnOf(inverse))}`
      + ` = ${reference(parentAlias, inverse.column ?? 'id')})`
  }

/** Build a correlated sub-select for each relation hop, innermost last. */
const throughHops =
  ( hops: Hop[]
  , leaf: (alias: string) => string
  , depth = 0
  , parentAlias = 't'): string => {
    const hop = hops[depth]
    if (!hop) return leaf(parentAlias)

    const targetAlias = `r${depth}`
    const inner = throughHops(hops, leaf, depth + 1, targetAlias)
    return wrapHop(hop, parentAlias, targetAlias, `j${depth}`, inner)
  }

const propertyOf =
  (schema: JSONSchema, columnName: string) =>
    Object.entries(schema.properties ?? {})
      .find(([key]) => snakeCase(key) === columnName)

/** The id, owner and visibility columns row scoping reads must come from the base row. */
const requireScopeProperty =
  ( schema: JSONSchema
  , base: TableDef
  , columnName: string
  , expectedFormat?: string) => {
    const found = propertyOf(schema, columnName)
    if (!found)
      throw new Error(`${schema.title}: views must expose "${columnName}"`)

    const [key, property] = found
    if (property['x-exposed'] === false)
      throw new Error(`${schema.title}: view property "${key}" cannot be hidden`)
    if (property['x-source'] !== `${base.tableName}.${columnName}`)
      throw new Error(
        `${schema.title}: "${key}" must source `
        + `"${base.tableName}.${columnName}"`)
    if (expectedFormat && property.format !== expectedFormat)
      throw new Error(
        `${schema.title}: "${key}" must use format "${expectedFormat}"`)
  }

export type AuthoredViewBuild =
  { authoredViews: Record<string, TableDef>
  , views: Record<string, ViewDef>
  }

/**
 * Build the SQL and resource metadata for schemas marked `x-view`.
 *
 * A view projects fields from a base table (`x-source`) and may follow its
 * relations. Relation-valued properties become JSON:API relationships.
 *
 * @param loaded - The schemas marked `x-view`.
 * @param tablesByName - Every built table, keyed by table name.
 * @param reservedNames - Table and generated-view names a view may not reuse.
 */
export const buildAuthoredViews =
  ( loaded: LoadedSchema[]
  , tablesByName: Map<string, TableDef>
  , reservedNames: Set<string>
  ): AuthoredViewBuild => {
    const authoredViews: Record<string, TableDef> = {}
    const views: Record<string, ViewDef> = {}
    const usedNames = new Set<string>()

    for (const entry of loaded) {
      const schema = structuredClone(entry.schema)
      const title = schema.title
      for (const [key, property] of Object.entries(schema.properties ?? {}))
        normalizePropertyTypes(title, property, key)

      validateExposure(title, schema['x-exposed'], 'view')
      if (typeof schema['x-source'] !== 'string'
          || schema['x-source'].length === 0)
        throw new Error(`${title}: x-view schemas need an x-source table`)
      if (schema['x-relations'] !== undefined)
        throw new Error(
          `${title}: views declare relations as properties with x-source`)

      const access = normalizeAccess(schema)
      if (access.shareable)
        throw new Error(`${title}: views cannot be shareable`)
      if (access.inherit)
        throw new Error(`${title}: views cannot inherit access`)
      const rawAccess = (schema['x-access'] ?? {}) as Record<string, unknown>
      if (rawAccess.create !== undefined && rawAccess.create !== 'none')
        throw new Error(
          `${title}: views are read-only; x-access create must be "none"`)

      const name = snakeCase(title)
      if (reservedNames.has(name))
        throw new Error(`${title}: view name "${name}" is already in use`)
      if (usedNames.has(name))
        throw new Error(`Duplicate view name "${name}"`)
      usedNames.add(name)

      const sourceTable = snakeCase(schema['x-source'])
      const base =
        need(tablesByName, sourceTable,
          `${title}: x-source table "${sourceTable}" does not exist`)
      if (!base.exposed)
        throw new Error(`${title}: x-source table "${sourceTable}" is hidden`)

      const columns: ColumnDef[] = []
      const relations: Record<string, RelationConfig> = {}
      const selectEntries: string[] = []
      const columnNames = new Set<string>()
      const relationLabels = new Set<string>()
      const requiredNames = new Set((schema.required ?? []).map(snakeCase))

      for (const [key, property] of Object.entries(schema.properties ?? {})) {
        const path = property['x-source']
        if (typeof path !== 'string' || path.length === 0)
          throw new Error(`${title}: property "${key}" needs an x-source path`)

        const source = resolveSource(title, key, base, path, tablesByName)
        if (source.kind === 'column') {
          const columnName = snakeCase(key)
          if (columnNames.has(columnName))
            throw new Error(`${title}: duplicate column "${columnName}"`)
          columnNames.add(columnName)

          const required = requiredNames.has(columnName)
          const exposed = property['x-exposed'] !== false
          columns.push(
            { key
            , columnName
            , schema: property
            , sql: buildColumn(key, property, required)
            , required
            , injected: false
            , exposed
            })

          if (exposed) {
            const value =
              source.hops.length === 0
                ? viewValue(source.column, 't')
                : throughHops(
                    source.hops
                    , alias =>
                        jsonValue(
                          source.column
                          , reference(alias, source.column.columnName)))
            selectEntries.push(`${value} AS ${quote(columnName)}`)
          }
          continue
        }

        const label = key
        if (columnNames.has(label) || relationLabels.has(label))
          throw new Error(
            `${title}: property "${key}" conflicts with another property`)
        relationLabels.add(label)

        const { relation } = source
        if (relation.cardinality === 'many' && property.type !== 'array')
          throw new Error(
            `${title}: relation property "${key}" is to-many; `
            + 'its type must be array')
        if (relation.cardinality === 'one' && property.type === 'array')
          throw new Error(
            `${title}: relation property "${key}" is to-one; `
            + 'its type must not be array')

        const exposed = property['x-exposed'] !== false
        relations[label] = { ...relation, exposed }
        if (exposed) {
          const finalHop =
            hopOf(title, key, source.table, relation, tablesByName)
          const value =
            throughHops(
              [...source.hops, finalHop]
              , alias => jsonObject(source.target, alias))
          selectEntries.push(`${value} AS ${quote(label)}`)
        }
      }

      requireScopeProperty(schema, base, 'id', 'uuid')
      requireScopeProperty(schema, base, 'owner', 'uuid')
      requireScopeProperty(schema, base, 'visibility')

      const sql =
        `CREATE VIEW ${quote(name)} AS\nSELECT\n  `
        + selectEntries.join(',\n  ')
        + `\nFROM ${quote(base.tableName)} AS ${quote('t')}`

      const definition: TableDef =
        { key: pascalCase(title)
        , tableName: name
        , createSql: ''
        , indexSql: []
        , schema
        , columns
        , isSystem: schema['x-system'] === true
        , derived: false
        , exposed: schema['x-exposed'] !== false
        , access: { ...access, create: 'none' }
        , relations
        , foreignKeys: []
        , uniqueConstraints: []
        , indexes: []
        , trigger: ''
        , sourceTable: base.tableName
        }

      authoredViews[name] = definition
      views[name] =
        { name
        , sql
        , dropSql: `DROP VIEW IF EXISTS ${quote(name)};`
        }
    }

    return { authoredViews, views }
  }

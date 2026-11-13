import
  { type BuiltSchema
  , type ColumnDef
  , type RelationConfig
  , type TableDef
  , type ViewDef
  } from './schema-types.ts'

export const quote =
  (value: string) => `\`${value.replaceAll('`', '``')}\``

const literal =
  (value: string) => `'${value.replaceAll("'", "''")}'`

export const reference =
  (alias: string, columnName: string) => `${quote(alias)}.${quote(columnName)}`

export const uuidString =
  (value: string) =>
    `(CASE WHEN ${value} IS NULL THEN NULL ELSE (`
    + `lower(hex(substr(${value}, 1, 4)))`
    + ` || '-' || lower(hex(substr(${value}, 5, 2)))`
    + ` || '-' || lower(hex(substr(${value}, 7, 2)))`
    + ` || '-' || lower(hex(substr(${value}, 9, 2)))`
    + ` || '-' || lower(hex(substr(${value}, 11, 6)))) END)`

export const jsonValue =
  (column: ColumnDef, value: string) => {
    if (column.schema.format === 'uuid') return uuidString(value)
    if (column.schema.format === 'byte')
      return `(CASE WHEN ${value} IS NULL THEN NULL ELSE lower(hex(${value})) END)`
    if (column.schema.type === 'boolean')
      return `(CASE WHEN ${value} IS NULL THEN NULL`
        + ` WHEN ${value} THEN json('true') ELSE json('false') END)`
    if (column.schema.type === 'object' || column.schema.type === 'array')
      return `json(${value})`
    return value
  }

const LIGHT_COLUMNS = ['id', 'owner', 'visibility']

/** JSON object of a row's exposed columns (light: only what linkage and access checks need). */
export const jsonObject =
  (table: TableDef, alias: string, light = false) => {
    const args = table.columns
      .filter(column =>
        column.exposed && (!light || LIGHT_COLUMNS.includes(column.columnName)))
      .flatMap(
        column =>
          [ literal(column.columnName)
          , jsonValue(column, reference(alias, column.columnName))
          ])
    return `json_object(${args.join(', ')})`
  }

export const viewValue =
  (column: ColumnDef, alias: string) => {
    const value = reference(alias, column.columnName)
    return column.schema.format === 'uuid' ? uuidString(value) : value
  }

/** Find the join table's foreign keys for the source and target sides. */
export const joinForeignKeys =
  (join: TableDef, sourceTable: string, targetTable: string) => {
    const toSource = join.foreignKeys.filter(x => x.foreignTable === sourceTable)
    const toTarget =
      sourceTable === targetTable
        ? toSource.slice(1)
        : join.foreignKeys.filter(x => x.foreignTable === targetTable)
    return { source: toSource[0], target: toTarget[0] }
  }

/** Fetch a named table or fail with a descriptive message. */
const need =
  <T>(map: Map<string, T>, name: string, message: string): T => {
    const found = map.get(name)
    if (!found) throw new Error(message)
    return found
  }

/** Build a correlated sub-select aggregating target rows into a JSON array. */
const groupedSelect =
  (target: TableDef, joinSql: string, whereSql: string, light: boolean) =>
    `(SELECT coalesce(json_group_array(${jsonObject(target, 'r', light)}), json('[]'))`
    + ` FROM ${quote(target.tableName)} AS ${quote('r')}`
    + joinSql
    + ` WHERE ${whereSql}`
    + ` ORDER BY ${reference('r', 'id')})`

export const foreignKeyColumnOf =
  (relation: RelationConfig) =>
    relation.foreignKey ?? `${relation.table}_${relation.column ?? 'id'}`

/** Build the JSON sub-select for a to-one relation. */
const oneExpression =
  (table: TableDef, relation: RelationConfig, tablesByName: Map<string, TableDef>, light: boolean) => {
    const target =
      need(tablesByName, relation.table,
        `${table.tableName}: relation targets unknown table "${relation.table}"`)

    return `(SELECT ${jsonObject(target, 'r', light)}`
      + ` FROM ${quote(target.tableName)} AS ${quote('r')}`
      + ` WHERE ${reference('r', relation.column ?? 'id')} =`
      + ` ${reference('t', foreignKeyColumnOf(relation))}`
      + ` LIMIT 1)`
  }

/** Build the JSON sub-select for a to-many relation via join table or inverse FK. */
const manyExpression =
  (table: TableDef, relation: RelationConfig, tablesByName: Map<string, TableDef>, light: boolean) => {
    const target =
      need(tablesByName, relation.table,
        `${table.tableName}: relation targets unknown table "${relation.table}"`)

    if (relation.through) {
      const join =
        need(tablesByName, relation.through,
          `${table.tableName}: join table "${relation.through}" does not exist`)

      const { source: sourceForeignKey, target: targetForeignKey } =
        joinForeignKeys(join, table.tableName, target.tableName)
      if (!sourceForeignKey || !targetForeignKey)
        throw new Error(
          `${table.tableName}: join table "${relation.through}" needs foreign keys to both tables`)

      return groupedSelect(
        target
        , ` JOIN ${quote(join.tableName)} AS ${quote('j')}`
          + ` ON ${reference('j', targetForeignKey.columns[0]!)}`
          + ` = ${reference('r', targetForeignKey.foreignColumns[0]!)}`
        , `${reference('j', sourceForeignKey.columns[0]!)}`
          + ` = ${reference('t', sourceForeignKey.foreignColumns[0]!)}`
        , light)
    }

    const inverse =
      Object.values(target.relations)
        .find(x => x.cardinality === 'one' && x.table === table.tableName)
    if (!inverse)
      throw new Error(
        `${table.tableName}: many relation to "${relation.table}" needs`
        + ' a join table or an inverse one relation')

    return groupedSelect(
      target
      , ''
      , `${reference('r', foreignKeyColumnOf(inverse))}`
        + ` = ${reference('t', inverse.column ?? 'id')}`
      , light)
  }

export type RelationMode = 'full' | 'light' | 'none'

export const selectSql =
  ( table: TableDef
  , tablesByName: Map<string, TableDef>
  /** The SELECT behind a resource: its columns plus each relation embedded as JSON per mode. */
  , mode: (label: string) => RelationMode = () => 'full') => {
    const relationEntries =
      Object.entries(table.relations)
        .filter(([label, relation]) =>
          relation.exposed !== false && mode(label) !== 'none')
        .sort(([a], [b]) => a.localeCompare(b))

    const columnNames = new Set(table.columns.map(x => x.columnName))
    for (const [label] of relationEntries)
      if (columnNames.has(label))
        throw new Error(
          `${table.tableName}: relation "${label}" conflicts with a column`)

    const selectEntries = [
      ...table.columns
        .filter(column => column.exposed)
        .map(
          column =>
            `${viewValue(column, 't')} AS ${quote(column.columnName)}`),
      ...relationEntries.map(
        ([label, relation]) =>
          (relation.cardinality === 'one' ? oneExpression : manyExpression)(
            table, relation, tablesByName, mode(label) === 'light')
          + ` AS ${quote(label)}`),
    ]

    return 'SELECT\n'
      + selectEntries.map(x => `  ${x}`).join(',\n')
      + `\nFROM ${quote(table.tableName)} AS ${quote('t')}`
  }

const buildView =
  (table: TableDef, tablesByName: Map<string, TableDef>): ViewDef => {
    const name = `${table.tableName}_view`
    return (
      { name
      , sql: `CREATE VIEW ${quote(name)} AS\n${selectSql(table, tablesByName)}`
      , dropSql: `DROP VIEW IF EXISTS ${quote(name)};`
      })
  }

export const buildViews =
  (built: BuiltSchema) => {
    const tablesByName =
      new Map(built.orderedTables.map(x => [x.tableName, x]))
    const views: Record<string, ViewDef> = {}

    for (const table of built.orderedTables) {
      if (!table.exposed) continue
      const view = buildView(table, tablesByName)
      views[view.name] = view
    }

    return views
  }

/**
 * The JOINs that lead from base-table alias `s` of `table` to base-table alias
 * `t` of the relation's target, through the join table (alias `j`) when there is one.
 */
export const relationJoin =
  ( table: TableDef
  , relation: RelationConfig
  , tablesByName: Map<string, TableDef>
  , s: string
  , t: string
  , j: string
  /** The table alias `s` reads from; authored views traverse their base table. */
  , sourceTableName = table.tableName) => {
    const target =
      need(tablesByName, relation.table,
        `${table.tableName}: relation targets unknown table "${relation.table}"`)
    const into = `JOIN ${quote(target.tableName)} AS ${quote(t)} ON `

    if (relation.cardinality === 'one')
      return into
        + `${reference(t, relation.column ?? 'id')} = ${reference(s, foreignKeyColumnOf(relation))}`

    if (relation.through) {
      const join =
        need(tablesByName, relation.through,
          `${table.tableName}: join table "${relation.through}" does not exist`)
      const keys = joinForeignKeys(join, sourceTableName, target.tableName)
      if (!keys.source || !keys.target)
        throw new Error(
          `${table.tableName}: join table "${relation.through}" needs foreign keys to both tables`)
      return `JOIN ${quote(join.tableName)} AS ${quote(j)} ON `
        + `${reference(j, keys.source.columns[0]!)} = ${reference(s, keys.source.foreignColumns[0]!)} `
        + into
        + `${reference(t, keys.target.foreignColumns[0]!)} = ${reference(j, keys.target.columns[0]!)}`
    }

    const inverse =
      Object.values(target.relations)
        .find(x => x.cardinality === 'one' && x.table === sourceTableName)
    if (!inverse)
      throw new Error(
        `${table.tableName}: many relation to "${relation.table}" needs a join table or an inverse one relation`)
    return into
      + `${reference(t, foreignKeyColumnOf(inverse))} = ${reference(s, inverse.column ?? 'id')}`
  }

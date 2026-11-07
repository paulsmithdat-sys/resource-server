import
  { type BuiltSchema
  , type ColumnDef
  , type RelationConfig
  , type TableDef
  , type ViewDef
  } from './schema-types.ts'

const quote =
  (value: string) => `\`${value.replaceAll('`', '``')}\``

const literal =
  (value: string) => `'${value.replaceAll("'", "''")}'`

const reference =
  (alias: string, columnName: string) => `${quote(alias)}.${quote(columnName)}`

const uuidString =
  (value: string) =>
    `(lower(hex(substr(${value}, 1, 4)))`
    + ` || '-' || lower(hex(substr(${value}, 5, 2)))`
    + ` || '-' || lower(hex(substr(${value}, 7, 2)))`
    + ` || '-' || lower(hex(substr(${value}, 9, 2)))`
    + ` || '-' || lower(hex(substr(${value}, 11, 6))))`

const jsonValue =
  (column: ColumnDef, value: string) => {
    if (column.schema.format === 'uuid') return uuidString(value)
    if (column.schema.format === 'byte') return `lower(hex(${value}))`
    if (column.schema.type === 'boolean')
      return `(CASE WHEN ${value} IS NULL THEN NULL`
        + ` WHEN ${value} THEN json('true') ELSE json('false') END)`
    if (column.schema.type === 'object' || column.schema.type === 'array')
      return `json(${value})`
    return value
  }

const jsonObject =
  (table: TableDef, alias: string) => {
    const args = table.columns.flatMap(
      column =>
        [ literal(column.columnName)
        , jsonValue(column, reference(alias, column.columnName))
        ])
    return `json_object(${args.join(', ')})`
  }

const viewValue =
  (column: ColumnDef, alias: string) => {
    const value = reference(alias, column.columnName)
    return column.schema.format === 'uuid' ? uuidString(value) : value
  }

const foreignKeyColumnOf =
  (relation: RelationConfig) =>
    relation.foreignKey ?? `${relation.table}_${relation.column ?? 'id'}`

const oneExpression =
  (table: TableDef, relation: RelationConfig, tablesByName: Map<string, TableDef>) => {
    const target = tablesByName.get(relation.table)
    if (!target)
      throw new Error(
        `${table.tableName}: relation targets unknown table "${relation.table}"`)

    const targetColumn = relation.column ?? 'id'
    return `(SELECT ${jsonObject(target, 'r')}`
      + ` FROM ${quote(target.tableName)} AS ${quote('r')}`
      + ` WHERE ${reference('r', targetColumn)} =`
      + ` ${reference('t', foreignKeyColumnOf(relation))}`
      + ` LIMIT 1)`
  }

const manyExpression =
  (table: TableDef, relation: RelationConfig, tablesByName: Map<string, TableDef>) => {
    const target = tablesByName.get(relation.table)
    if (!target)
      throw new Error(
        `${table.tableName}: relation targets unknown table "${relation.table}"`)

    if (relation.through) {
      const join = tablesByName.get(relation.through)
      if (!join)
        throw new Error(
          `${table.tableName}: join table "${relation.through}" does not exist`)

      const sourceForeignKey =
        join.foreignKeys.find(x => x.foreignTable === table.tableName)
      const targetForeignKey =
        join.foreignKeys.find(x => x.foreignTable === target.tableName)
      if (!sourceForeignKey || !targetForeignKey)
        throw new Error(
          `${table.tableName}: join table "${relation.through}" needs foreign keys to both tables`)

      return `(SELECT coalesce(json_group_array(${jsonObject(target, 'r')}), json('[]'))`
        + ` FROM ${quote(target.tableName)} AS ${quote('r')}`
        + ` JOIN ${quote(join.tableName)} AS ${quote('j')}`
        + ` ON ${reference('j', targetForeignKey.columns[0]!)}`
        + ` = ${reference('r', targetForeignKey.foreignColumns[0]!)}`
        + ` WHERE ${reference('j', sourceForeignKey.columns[0]!)}`
        + ` = ${reference('t', sourceForeignKey.foreignColumns[0]!)}`
        + ` ORDER BY ${reference('r', 'id')})`
    }

    const inverse =
      Object.values(target.relations)
        .find(x => x.cardinality === 'one' && x.table === table.tableName)
    if (!inverse)
      throw new Error(
        `${table.tableName}: many relation to "${relation.table}" needs`
        + ' a join table or an inverse one relation')

    return `(SELECT coalesce(json_group_array(${jsonObject(target, 'r')}), json('[]'))`
      + ` FROM ${quote(target.tableName)} AS ${quote('r')}`
      + ` WHERE ${reference('r', foreignKeyColumnOf(inverse))}`
      + ` = ${reference('t', inverse.column ?? 'id')}`
      + ` ORDER BY ${reference('r', 'id')})`
  }

const buildView =
  (table: TableDef, tablesByName: Map<string, TableDef>): ViewDef => {
    const relationEntries =
      Object.entries(table.relations)
        .sort(([a], [b]) => a.localeCompare(b))

    const columnNames = new Set(table.columns.map(x => x.columnName))
    for (const [label] of relationEntries)
      if (columnNames.has(label))
        throw new Error(
          `${table.tableName}: relation "${label}" conflicts with a column`)

    const selectEntries = [
      ...table.columns.map(
        column =>
          `${viewValue(column, 't')} AS ${quote(column.columnName)}`),
      ...relationEntries.map(
        ([label, relation]) =>
          ( relation.cardinality === 'one'
            ? oneExpression(table, relation, tablesByName)
            : manyExpression(table, relation, tablesByName)
          ) + ` AS ${quote(label)}`),
    ]

    const name = `${table.tableName}_view`

    return (
      { name
      , sql:
          `CREATE VIEW ${quote(name)} AS\nSELECT\n`
          + selectEntries.map(x => `  ${x}`).join(',\n')
          + `\nFROM ${quote(table.tableName)} AS ${quote('t')}`
      , dropSql: `DROP VIEW IF EXISTS ${quote(name)};`
      })
  }

export const buildViews =
  (built: BuiltSchema) => {
    const tablesByName =
      new Map(built.orderedTables.map(x => [x.tableName, x]))
    const views: Record<string, ViewDef> = {}

    for (const table of built.orderedTables) {
      const view = buildView(table, tablesByName)
      views[view.name] = view
    }

    return views
  }

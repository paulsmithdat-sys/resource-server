import type { ColumnSql } from '../schema-types.ts'
import type { TablePlan } from './plan.ts'

export const sortPlansByDependencies =
  (plans: TablePlan[]) => {
    const byName = new Map(plans.map(x => [x.tableName, x]))
    const state = new Map<string, 'visiting' | 'done'>()
    const sorted: TablePlan[] = []

    const visit =
      (plan: TablePlan) => {
        const current = state.get(plan.tableName)
        if (current === 'done') return
        if (current === 'visiting')
          throw new Error(
            `Cyclic foreign key dependency involving "${plan.tableName}" is not supported yet`)

        state.set(plan.tableName, 'visiting')

        for (const foreignKeyDef of plan.foreignKeys) {
          if (foreignKeyDef.foreignTable === plan.tableName) continue

          const target = byName.get(foreignKeyDef.foreignTable)
          if (!target)
            throw new Error(
              `${plan.tableName}: foreign key references unknown table "${foreignKeyDef.foreignTable}"`)

          visit(target)
        }

        state.set(plan.tableName, 'done')
        sorted.push(plan)
      }

    for (const plan of [...plans].sort(
      (a, b) => a.tableName.localeCompare(b.tableName)))
      visit(plan)

    return sorted
  }

const quote = (name: string) => `\`${name}\``

const columnSql =
  (name: string, column: ColumnSql) =>
    [ quote(name)
    , column.type
    , column.primaryKey ? 'PRIMARY KEY' : ''
    , column.default === undefined ? '' : `DEFAULT ${column.default}`
    , column.notNull ? 'NOT NULL' : ''
    , column.unique ? 'UNIQUE' : ''
    ].filter(Boolean).join(' ')

/** The constraint clauses of a table: foreign keys, checks and unique constraints. */
const constraints =
  (plan: TablePlan) => {
    const { tableName } = plan
    const list: string[] = []
    const columnList = (names: string[]) => names.map(quote).join(', ')

    for (const fk of plan.foreignKeys)
      list.push(
        `CONSTRAINT ${quote(`${tableName}_${fk.columns.join('_')}_fk`)} `
        + `FOREIGN KEY (${columnList(fk.columns)}) `
        + `REFERENCES ${quote(fk.foreignTable)}(${columnList(fk.foreignColumns)})`
        + (fk.onDelete ? ` ON DELETE ${fk.onDelete.toUpperCase()}` : '')
        + (fk.onUpdate ? ` ON UPDATE ${fk.onUpdate.toUpperCase()}` : ''))

    for (const constraint of plan.uniqueConstraints)
      list.push(
        `CONSTRAINT ${quote(`${tableName}_${constraint.join('_')}_unique`)} `
        + `UNIQUE(${columnList(constraint)})`)

    if (plan.columns.some(x => x.columnName === 'visibility'))
      list.push(
        `CONSTRAINT ${quote(`${tableName}_visibility_check`)} CHECK(\`visibility\` IN `
        + `(${plan.access.visibility.map(x => `'${x}'`).join(', ')}))`)

    const checks = plan.schema['x-checks'] ?? []
    if (!Array.isArray(checks) || checks.some(x => typeof x !== 'string'))
      throw new Error(`${plan.schema.title}: x-checks must be a list of SQL expressions`)
    checks.forEach((expression, i) =>
      list.push(`CONSTRAINT ${quote(`${tableName}_check_${i}`)} CHECK(${expression})`))

    return list
  }

/** The `CREATE TABLE` statement for a plan, under its own name or another (used when rebuilding). */
export const createTableSql =
  (plan: TablePlan, name = plan.tableName) => {
    const lines = [...plan.columns.map(x => columnSql(x.columnName, x.sql)), ...constraints(plan)]
    const verb = name === plan.tableName ? 'CREATE TABLE IF NOT EXISTS' : 'CREATE TABLE'
    return `${verb} ${quote(name)} (\n  ${lines.join(',\n  ')}\n)`
  }

/** The `CREATE INDEX` statements of a plan. */
export const createIndexSql =
  (plan: TablePlan) =>
    plan.indexes.map(column =>
      `CREATE INDEX IF NOT EXISTS ${quote(`${plan.tableName}_${column}_index`)} `
      + `ON ${quote(plan.tableName)} (${quote(column)})`)

import { sql } from 'drizzle-orm'
import
  { check
  , foreignKey
  , index
  , sqliteTable
  , unique
  , type SQLiteColumn
  , type SQLiteColumnBuilder
  , type SQLiteTable
  , type ForeignKeyBuilder
  , type IndexBuilder
  , type CheckBuilder
  , type UniqueConstraintBuilder
  } from 'drizzle-orm/sqlite-core'
import { type TablePlan } from './plan.ts'

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

const columnKeyFor =
  (plan: TablePlan, columnName: string) => {
    const column = plan.columns.find(x => x.columnName === columnName)
    if (!column)
      throw new Error(
        `${plan.tableName}: column "${columnName}" does not exist`)
    return column.key
  }

export const createDrizzleTable =
  ( plan: TablePlan
  , plansByName: Map<string, TablePlan>
  /** Create the drizzle table for a plan, with its foreign keys, checks, uniques and indexes. */
  , tablesByName: Map<string, SQLiteTable>) => {
    const columns =
      Object.fromEntries(plan.columns.map(x => [x.key, x.drizzle])) as Record<string, SQLiteColumnBuilder>

    return sqliteTable(plan.tableName, columns, self => {
      const extras: (ForeignKeyBuilder | IndexBuilder | CheckBuilder | UniqueConstraintBuilder)[] = []
      const columnsOf = self as unknown as Record<string, SQLiteColumn>

      for (const foreignKeyDef of plan.foreignKeys) {
        const selfReference =
          foreignKeyDef.foreignTable === plan.tableName
        const targetPlan =
          selfReference ? plan : plansByName.get(foreignKeyDef.foreignTable)
        const targetTable =
          selfReference ? self : tablesByName.get(foreignKeyDef.foreignTable)
        if (!targetPlan || !targetTable)
          throw new Error(
            `${plan.tableName}: foreign key target "${foreignKeyDef.foreignTable}" has not been built`)

        const localColumns =
          foreignKeyDef.columns.map(
            x => columnsOf[columnKeyFor(plan, x)]!) as [SQLiteColumn, ...SQLiteColumn[]]
        const targetColumns =
          foreignKeyDef.foreignColumns.map(
            x => (targetTable as unknown as Record<string, SQLiteColumn>)[columnKeyFor(targetPlan, x)]!) as [SQLiteColumn, ...SQLiteColumn[]]

        const builder =
          foreignKey(
            { name: `${plan.tableName}_${foreignKeyDef.columns.join('_')}_fk`
            , columns: localColumns
            , foreignColumns: targetColumns
            })
        if (foreignKeyDef.onDelete) builder.onDelete(foreignKeyDef.onDelete)
        if (foreignKeyDef.onUpdate) builder.onUpdate(foreignKeyDef.onUpdate)
        extras.push(builder)
      }

      const visibility = plan.columns.find(x => x.columnName === 'visibility')
      if (visibility)
        extras.push(
          check(
            `${plan.tableName}_visibility_check`
            , sql.raw(
                `\`visibility\` IN (${plan.access.visibility.map(x => `'${x}'`).join(', ')})`)))

      const checks = plan.schema['x-checks'] ?? []
      if (!Array.isArray(checks) || checks.some(x => typeof x !== 'string'))
        throw new Error(`${plan.schema.title}: x-checks must be a list of SQL expressions`)
      checks.forEach((expression, i) =>
        extras.push(check(`${plan.tableName}_check_${i}`, sql.raw(expression))))

      for (const constraint of plan.uniqueConstraints) {
        const args =
          constraint.map(
            x => columnsOf[columnKeyFor(plan, x)]!) as [SQLiteColumn, ...SQLiteColumn[]]
        extras.push(
          unique(`${plan.tableName}_${constraint.join('_')}_unique`).on(...args))
      }

      for (const columnName of plan.indexes) {
        extras.push(
          index(`${plan.tableName}_${columnName}_index`)
            .on(columnsOf[columnKeyFor(plan, columnName)]!))
      }

      return extras
    })
  }

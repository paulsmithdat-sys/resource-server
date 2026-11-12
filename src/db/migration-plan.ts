import { createTableSql } from './build/ddl.ts'
import type { BuiltSchema, TableDef } from './schema-types.ts'

/** Separates statements in a migration file (triggers contain semicolons, so `;` cannot). */
export const BREAKPOINT = '--> statement-breakpoint'

/** A table, view or trigger the schemas call for. Its key is `kind:name`. */
export type DbObject =
  { key: string
  , statements: string[]
  , columns?: string[]
  , rebuild?: (previousColumns: string[]) => string[]
  }

/** What a migration recorded about each object, so the next one can tell what changed. */
export type ObjectState = Record<string, { statements: string[], columns?: string[] }>

const quote = (name: string) => `\`${name}\``

/** Statements that replace a table whose definition changed, keeping the rows of surviving columns. */
const rebuildTable =
  (table: TableDef, previousColumns: string[]) => {
    const name = quote(table.tableName)
    const temporary = quote(`__new_${table.tableName}`)
    const kept =
      table.columns
        .map(x => x.columnName)
        .filter(x => previousColumns.includes(x))
        .map(quote)
        .join(', ')

    return (
      [ createTableSql(table, `__new_${table.tableName}`)
      , ...(kept ? [`INSERT INTO ${temporary} (${kept}) SELECT ${kept} FROM ${name}`] : [])
      , `DROP TABLE ${name}`
      , `ALTER TABLE ${temporary} RENAME TO ${name}`
      , ...table.indexSql
      ])
  }

/** Every table, trigger and view of a built schema. */
export const databaseObjects =
  (built: BuiltSchema): DbObject[] => [
    ...built.orderedTables.map(table => (
      { key: `table:${table.tableName}`
      , statements: [table.createSql, ...table.indexSql]
      , columns: table.columns.map(x => x.columnName)
      , rebuild: (previous: string[]) => rebuildTable(table, previous)
      })),
    ...built.orderedTables.map(table => (
      { key: `trigger:${table.tableName}_updated`
      , statements: [table.trigger]
      })),
    ...Object.values(built.views).map(view => (
      { key: `view:${view.name}`
      , statements: [view.sql]
      })),
  ]

export const stateOf =
  (objects: DbObject[]): ObjectState =>
    Object.fromEntries(
      objects.map(x =>
        [ x.key
        , { statements: x.statements, ...(x.columns ? { columns: x.columns } : {}) }
        ]))

const isTable = (key: string) => key.startsWith('table:')

const dropSql =
  (key: string) => {
    const split = key.indexOf(':')
    return `DROP ${key.slice(0, split).toUpperCase()} IF EXISTS ${quote(key.slice(split + 1))}`
  }

/**
 * The statements that bring a database from the recorded state to the wanted
 * objects. Views and triggers are dropped before any table is rebuilt or
 * removed, then created again afterwards, because SQLite checks them when a
 * table is renamed.
 */
export const planMigration =
  (wanted: DbObject[], recorded: ObjectState) => {
    const same =
      (object: DbObject) =>
        JSON.stringify(recorded[object.key]?.statements) === JSON.stringify(object.statements)
    const wantedKeys = new Set(wanted.map(x => x.key))
    const goneTables = Object.keys(recorded).filter(x => isTable(x) && !wantedKeys.has(x))
    const tables = wanted.filter(x => isTable(x.key))
    const tablesChanged = goneTables.length > 0 || tables.some(x => x.key in recorded && !same(x))
    const derived = wanted.filter(x => !isTable(x.key))

    const toCreate = derived.filter(x => tablesChanged || !same(x))
    const goneDerived =
      Object.keys(recorded).filter(x => !isTable(x) && !wantedKeys.has(x))
    const dropped = [...goneDerived, ...toCreate.map(x => x.key)]

    return (
      [ ...new Set(dropped.map(dropSql))
      , ...goneTables.map(dropSql)
      , ...tables.filter(x => !same(x)).flatMap(x =>
          recorded[x.key] ? x.rebuild!(recorded[x.key]!.columns ?? []) : x.statements)
      , ...toCreate.flatMap(x => x.statements)
      ])
  }

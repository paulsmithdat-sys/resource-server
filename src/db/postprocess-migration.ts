import type { CustomDdlEntry } from './custom-ddl.ts'

const breakpoint = '--> statement-breakpoint'

export const addIfNotExists =
  (sql: string) =>
    sql.replace(
      /\bCREATE\s+(TABLE|UNIQUE\s+INDEX|INDEX)\s+(?!IF\s+NOT\s+EXISTS)/gi
      , (_match, kind: string) => `CREATE ${kind} IF NOT EXISTS `)

const ensureSemicolon =
  (sql: string) => {
    const trimmed = sql.trim()
    return trimmed.endsWith(';') ? trimmed : `${trimmed};`
  }

export const appendCustomDdl =
  (sql: string, entries: CustomDdlEntry[]) => {
    if (entries.length === 0)
      return sql.trimEnd() + '\n'

    const statements =
      entries.flatMap(entry =>
        entry.sql.trim()
          ? [ ensureSemicolon(entry.dropSql)
            , ensureSemicolon(entry.sql)
            ]
          : [ ensureSemicolon(entry.dropSql) ])

    return (
      sql.trimEnd()
      + '\n'
      + breakpoint
      + '\n'
      + statements.join(`\n${breakpoint}\n`)
      + '\n')
  }

/** List tables drizzle-kit rebuilt (which silently drops their triggers). */
export const recreatedTables =
  (sql: string) =>
    [...sql.matchAll(/ALTER TABLE `__new_([^`]+)` RENAME TO/g)].map(x => x[1]!)

/** Make the migration idempotent and restore triggers on rebuilt tables. */
export const postprocessMigration =
  (sql: string, entries: CustomDdlEntry[], desired: CustomDdlEntry[] = []) => {
    const rebuilt = new Set(recreatedTables(sql).map(x => `trigger:${x}`))
    const restored =
      desired.filter(x => rebuilt.has(x.key) && !entries.some(e => e.key === x.key))
    return appendCustomDdl(addIfNotExists(sql), [...entries, ...restored])
  }

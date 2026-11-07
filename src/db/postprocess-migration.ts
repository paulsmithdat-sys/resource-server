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
        [ ensureSemicolon(entry.dropSql)
        , ensureSemicolon(entry.sql)
        ])

    return (
      sql.trimEnd()
      + '\n'
      + breakpoint
      + '\n'
      + statements.join(`\n${breakpoint}\n`)
      + '\n')
  }

export const postprocessMigration =
  (sql: string, entries: CustomDdlEntry[]) =>
    appendCustomDdl(addIfNotExists(sql), entries)

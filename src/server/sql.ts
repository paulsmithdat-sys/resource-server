import { quote } from '../db/views.ts'
import type { Row, RowDatabase, RunResult } from './database.ts'

export type Values = Record<string, unknown>

const where =
  (conditions: Values) =>
    // Purpose: render `col = ? AND ...` for the given column/value pairs
    Object.keys(conditions).map(x => `${quote(x)} = ?`).join(' AND ')

export const exists =
  async (db: RowDatabase, table: string, conditions: Values) => {
    // Purpose: report whether any row in the table matches all the conditions
    const row =
      await db.get(
        `SELECT 1 AS found FROM ${quote(table)} WHERE ${where(conditions)} LIMIT 1`
        , Object.values(conditions))
    return row !== undefined
  }

export const insert =
  (db: RowDatabase, table: string, values: Values): Promise<Row | undefined> => {
    // Purpose: insert one row (defaults when empty) and return its new id
    const columns = Object.keys(values)
    const sql =
      columns.length === 0
        ? 'DEFAULT VALUES'
        : `(${columns.map(quote).join(', ')})`
          + ` VALUES (${columns.map(() => '?').join(', ')})`
    return db.get(
      `INSERT INTO ${quote(table)} ${sql} RETURNING \`id\``, Object.values(values))
  }

export const update =
  (db: RowDatabase, table: string, set: Values, conditions: Values): Promise<RunResult> => {
    // Purpose: set the given columns on every row matching the conditions
    const assignments = Object.keys(set).map(x => `${quote(x)} = ?`).join(', ')
    return db.run(
      `UPDATE ${quote(table)} SET ${assignments} WHERE ${where(conditions)}`
      , [...Object.values(set), ...Object.values(conditions)])
  }

export const remove =
  (db: RowDatabase, table: string, conditions: Values): Promise<RunResult> => {
    // Purpose: delete every row matching the conditions
    return db.run(
      `DELETE FROM ${quote(table)} WHERE ${where(conditions)}`
      , Object.values(conditions))
  }

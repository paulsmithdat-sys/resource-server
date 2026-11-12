import { quote } from '../db/views.ts'
import type { Row, RowDatabase, RunResult } from './database.ts'

export type Values = Record<string, unknown>

/** Render `col = ? AND ...` for the given column/value pairs. */
const where =
  (conditions: Values) =>
    Object.keys(conditions).map(x => `${quote(x)} = ?`).join(' AND ')

/** Report whether any row in the table matches all the conditions. */
export const exists =
  async (db: RowDatabase, table: string, conditions: Values) => {
    const row =
      await db.get(
        `SELECT 1 AS found FROM ${quote(table)} WHERE ${where(conditions)} LIMIT 1`
        , Object.values(conditions))
    return row !== undefined
  }

/** Insert one row (defaults when empty) and return its new id. */
export const insert =
  (db: RowDatabase, table: string, values: Values): Promise<Row | undefined> => {
    const columns = Object.keys(values)
    const sql =
      columns.length === 0
        ? 'DEFAULT VALUES'
        : `(${columns.map(quote).join(', ')})`
          + ` VALUES (${columns.map(() => '?').join(', ')})`
    return db.get(
      `INSERT INTO ${quote(table)} ${sql} RETURNING \`id\``, Object.values(values))
  }

/** Set the given columns on every row matching the conditions. */
export const update =
  (db: RowDatabase, table: string, set: Values, conditions: Values): Promise<RunResult> => {
    const assignments = Object.keys(set).map(x => `${quote(x)} = ?`).join(', ')
    return db.run(
      `UPDATE ${quote(table)} SET ${assignments} WHERE ${where(conditions)}`
      , [...Object.values(set), ...Object.values(conditions)])
  }

/** Delete every row matching the conditions. */
export const remove =
  (db: RowDatabase, table: string, conditions: Values): Promise<RunResult> => {
    return db.run(
      `DELETE FROM ${quote(table)} WHERE ${where(conditions)}`
      , Object.values(conditions))
  }

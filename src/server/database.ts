import { db } from '../helper/loadDb.ts'

export type Row = Record<string, unknown>

export type RunResult =
  { changes: number
  , lastInsertRowid: number
  }

export type RowDatabase =
  { all: (sql: string, params?: unknown[]) => Promise<Row[]>
  , get: (sql: string, params?: unknown[]) => Promise<Row | undefined>
  , run: (sql: string, params?: unknown[]) => Promise<RunResult>
  }

export type SqlStatement =
  { all: (...params: unknown[]) => Promise<Row[]>
  , get: (...params: unknown[]) => Promise<Row | undefined>
  , run: (...params: unknown[]) => Promise<RunResult>
  }

export type SqlConnection =
  { prepare: (sql: string) => Promise<SqlStatement>
  }

export const createRowDatabase =
  (connection: SqlConnection): RowDatabase => (
    { all: async (sql, params = []) => {
        const statement = await connection.prepare(sql)
        return await statement.all(...params)
      }
    , get: async (sql, params = []) => {
        const statement = await connection.prepare(sql)
        return await statement.get(...params)
      }
    , run: async (sql, params = []) => {
        const statement = await connection.prepare(sql)
        return await statement.run(...params)
      }
    })

export const tursoDatabase: RowDatabase = createRowDatabase(db)

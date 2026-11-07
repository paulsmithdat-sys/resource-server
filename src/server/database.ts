import { db } from '../helper/loadDb.ts'

export type Row = Record<string, unknown>

export type RowDatabase =
  { all: (sql: string, params?: unknown[]) => Promise<Row[]>
  , get: (sql: string, params?: unknown[]) => Promise<Row | undefined>
  }

export const tursoDatabase: RowDatabase =
  { all: async (sql, params = []) => {
      const statement = await db.prepare(sql)
      return await statement.all(...params)
    }
  , get: async (sql, params = []) => {
      const statement = await db.prepare(sql)
      return await statement.get(...params)
    }
  }

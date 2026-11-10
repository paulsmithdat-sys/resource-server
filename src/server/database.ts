export type Row = Record<string, unknown>

export type RunResult =
  { changes: number
  , lastInsertRowid: number
  }

export type RowDatabase =
  { all: (sql: string, params?: unknown[]) => Promise<Row[]>
  , get: (sql: string, params?: unknown[]) => Promise<Row | undefined>
  , run: (sql: string, params?: unknown[]) => Promise<RunResult>
  , transaction?:
      <T>(fn: (db: RowDatabase) => Promise<T>) => Promise<T>
  }

export type SqlStatement =
  { all: (...params: unknown[]) => Promise<Row[]>
  , get: (...params: unknown[]) => Promise<Row | undefined>
  , run: (...params: unknown[]) => Promise<RunResult>
  }

export type SqlTransactionFactory =
  (fn: (transaction: SqlConnection) => Promise<unknown>) =>
    (...args: unknown[]) => Promise<unknown>

export type SqlConnection =
  { prepare: (sql: string) => Promise<SqlStatement>
  , transactionAsync?: SqlTransactionFactory
  }

export const createRowDatabase =
  (connection: SqlConnection): RowDatabase => {
    const database: RowDatabase =
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
      }

    if (connection.transactionAsync) {
      database.transaction =
        async <T>(fn: (db: RowDatabase) => Promise<T>): Promise<T> => {
          const wrapped =
            connection.transactionAsync!(
              async transaction =>
                await fn(createRowDatabase(transaction)))
          return await wrapped() as T
        }
    }

    return database
  }

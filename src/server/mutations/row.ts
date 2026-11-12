import type { Row, RowDatabase } from '../database.ts'
import type { ResourceMeta } from '../registry.ts'
import { quoteIdentifier } from '../query.ts'
import { type Scope } from '../scope.ts'

export const readResourceRow =
  (db: RowDatabase, resource: ResourceMeta, id: string, scope: Scope = { sql: '', params: [] }): Promise<Row | undefined> =>
    db.get(
      `SELECT * FROM ${quoteIdentifier(resource.view)} WHERE \`id\` = ?`
      + (scope.sql ? ` AND ${scope.sql}` : '')
      + ' LIMIT 1'
      , [id, ...scope.params])

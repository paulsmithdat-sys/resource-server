import { describe, expect, test } from 'bun:test'
import { connect } from '@tursodatabase/database'
import { applyMigrations } from '../../../src/db/migrate.ts'

/** List the user tables in a database. */
const tableNames =
  async (connection: any) => {
    const rows =
      await (await connection.prepare(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE '\\_\\_%' ESCAPE '\\' ORDER BY name")).all()
    return rows.map((x: any) => x.name as string)
  }

describe('applyMigrations', () => {
  test('brings an empty database up to date and is a no-op when repeated', async () => {
    const connection =
      await connect(':memory:', { experimental: ['views', 'custom_types', 'encryption', 'vacuum'] })

    await applyMigrations(connection)
    const first = await tableNames(connection)
    expect(first).toContain('article')
    expect(first).toContain('audit_log')
    expect(first).toContain('note_share')

    await applyMigrations(connection)
    expect(await tableNames(connection)).toEqual(first)
  })
})

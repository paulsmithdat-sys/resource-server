import { describe, expect, test } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { connect } from '@tursodatabase/database'
import { buildSchema } from '../../../src/db/build-schema.ts'
import { generateMigrations } from '../../../src/db/generate-migration.ts'
import { applyMigrations } from '../../../src/db/migrate.ts'
import { databaseObjects, planMigration, stateOf } from '../../../src/db/migration-plan.ts'
import type { JSONSchema } from '../../../src/db/schema-types.ts'
import { loadedSchema } from './build-schema.helpers.ts'

const widget =
  (properties: JSONSchema['properties'] = { name: { type: 'string' } }): JSONSchema =>
    ({ title: 'Widget', type: 'object', properties })

const objectsOf = (...schemas: JSONSchema[]) =>
  databaseObjects(buildSchema(schemas.map(loadedSchema)))

describe('planMigration', () => {
  test('creates every table, trigger and view from nothing', () => {
    const statements = planMigration(objectsOf(widget()), {})

    expect(statements.some(x => x.startsWith('CREATE TABLE IF NOT EXISTS `widget`'))).toBe(true)
    expect(statements.some(x => x.startsWith('CREATE INDEX IF NOT EXISTS `widget_owner_index`'))).toBe(true)
    expect(statements.some(x => x.startsWith('CREATE TRIGGER IF NOT EXISTS `widget_updated`'))).toBe(true)
  })

  test('plans nothing when the recorded state matches', () => {
    const objects = objectsOf(widget())
    expect(planMigration(objects, stateOf(objects))).toEqual([])
  })

  test('rebuilds a changed table, keeping surviving columns, and recreates triggers', () => {
    const before = objectsOf(widget())
    const after = objectsOf(widget({ name: { type: 'string' }, size: { type: 'integer' } }))
    const statements = planMigration(after, stateOf(before))

    const drop = statements.indexOf('DROP TRIGGER IF EXISTS `widget_updated`')
    const rename = statements.findIndex(x => x.startsWith('ALTER TABLE `__new_widget` RENAME TO'))
    const create = statements.findIndex(x => x.startsWith('CREATE TRIGGER'))
    expect(drop).toBeGreaterThanOrEqual(0)
    expect(drop).toBeLessThan(rename)
    expect(rename).toBeLessThan(create)
    expect(statements.some(x => x.includes('INSERT INTO `__new_widget` (`id`, `updated_at`, `owner`, `visibility`, `name`)'))).toBe(true)
  })

  test('only touches a changed view or trigger when no table changed', () => {
    const before = objectsOf(widget())
    const edited = before.map(x => x.key.startsWith('trigger:') ? { ...x, statements: ['CREATE TRIGGER x'] } : x)
    expect(planMigration(edited, stateOf(before)))
      .toEqual(['DROP TRIGGER IF EXISTS `widget_updated`', 'CREATE TRIGGER x'])
  })

  test('drops a table that is no longer wanted', () => {
    const other: JSONSchema = { title: 'Gadget', type: 'object', properties: {} }
    const statements = planMigration(objectsOf(widget()), stateOf(objectsOf(widget(), other)))
    expect(statements).toContain('DROP TABLE IF EXISTS `gadget`')
  })
})

describe('migrations against a database that already has data', () => {
  test('a changed schema keeps rows, keeps child rows, and keeps triggers working', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'serber-migrate-'))
    const connection =
      await connect(':memory:', { experimental: ['views', 'custom_types', 'encryption', 'vacuum'] })
    const rows = async (sql: string) => (await connection.prepare(sql)).all()

    try {
      const parent: JSONSchema =
        { title: 'Widget'
        , type: 'object'
        , properties: { name: { type: 'string' }, legacy: { type: 'string' } }
        }
      const child: JSONSchema =
        { title: 'Part'
        , type: 'object'
        , properties: { label: { type: 'string' }, widget_id: { type: 'string', format: 'uuid' } }
        , 'x-relations':
          { widget: { table: 'widget', cardinality: 'one', foreignKey: 'widget_id', onDelete: 'cascade' } }
        }

      await generateMigrations(dir, [parent, child].map(loadedSchema))
      await connection.exec('PRAGMA foreign_keys = ON')
      await applyMigrations(connection, dir)
      await connection.exec("INSERT INTO widget (id, name, legacy) VALUES (x'01', 'bolt', 'old')")
      await connection.exec("INSERT INTO part (id, label, widget_id) VALUES (x'02', 'thread', x'01')")

      const changed: JSONSchema = { ...parent, properties: { name: { type: 'string' }, size: { type: 'integer' } } }
      const result = await generateMigrations(dir, [changed, child].map(loadedSchema))
      expect(result.migration).toBeDefined()
      await applyMigrations(connection, dir)

      expect(await rows('SELECT name, size FROM widget')).toEqual([{ name: 'bolt', size: null }])
      expect((await rows('SELECT label FROM part')).length).toBe(1)

      const before = (await rows("SELECT updated_at FROM widget"))[0]!.updated_at
      await connection.exec("UPDATE widget SET name = 'nut' WHERE id = x'01'")
      expect((await rows('SELECT updated_at FROM widget'))[0]!.updated_at).toBeGreaterThanOrEqual(before as number)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})

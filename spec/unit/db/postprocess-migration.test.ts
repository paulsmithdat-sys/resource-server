import { describe, expect, test } from 'bun:test'
import type { CustomDdlEntry } from '../../../src/db/custom-ddl.ts'
import
  { addIfNotExists
  , appendCustomDdl
  , postprocessMigration
  } from '../../../src/db/postprocess-migration.ts'

const triggerEntry: CustomDdlEntry =
  { key: 'trigger:widget'
  , kind: 'trigger'
  , name: 'widget_updated'
  , sql: 'CREATE TRIGGER IF NOT EXISTS `widget_updated` AFTER UPDATE ON `widget` BEGIN SELECT 1; END;'
  , dropSql: 'DROP TRIGGER IF EXISTS `widget_updated`;'
  }

describe('addIfNotExists', () => {
  test('guards table and index creation', () => {
    const input = [
      'CREATE TABLE `widget` (`id` blob PRIMARY KEY);',
      'CREATE UNIQUE INDEX `widget_name` ON `widget` (`name`);',
      'CREATE INDEX `widget_created` ON `widget` (`updated_at`);',
    ].join('\n')

    const result = addIfNotExists(input)
    expect(result).toContain('CREATE TABLE IF NOT EXISTS `widget`')
    expect(result).toContain('CREATE UNIQUE INDEX IF NOT EXISTS `widget_name`')
    expect(result).toContain('CREATE INDEX IF NOT EXISTS `widget_created`')
  })

  test('does not add duplicate guards', () => {
    const input = 'CREATE TABLE IF NOT EXISTS `widget` (`id` blob PRIMARY KEY);'
    expect(addIfNotExists(input)).toBe(input)
  })
})

describe('appendCustomDdl', () => {
  test('appends drop and create statements with breakpoints', () => {
    const input = 'CREATE TABLE `widget` (`id` blob PRIMARY KEY);'
    const result = appendCustomDdl(input, [triggerEntry])

    expect(result).toContain('--> statement-breakpoint')
    expect(result.indexOf('DROP TRIGGER IF EXISTS')).toBeLessThan(
      result.indexOf('CREATE TRIGGER IF NOT EXISTS'))
    expect(result.trimEnd().endsWith('END;')).toBe(true)
  })

  test('appends a drop without a create for removed DDL', () => {
    const removed: CustomDdlEntry =
      { key: 'view:key_view'
      , kind: 'view'
      , name: 'key_view'
      , sql: ''
      , dropSql: 'DROP VIEW IF EXISTS `key_view`;'
      }

    const result = appendCustomDdl('CREATE TABLE `widget` (`id` blob);\n', [removed])
    expect(result).toContain('DROP VIEW IF EXISTS `key_view`;')
    expect(result).not.toContain('CREATE VIEW')
  })

  test('leaves the migration unchanged when there is no custom DDL', () => {
    const input = 'CREATE TABLE `widget` (`id` blob PRIMARY KEY);\n'
    expect(appendCustomDdl(input, [])).toBe(input)
  })
})

describe('postprocessMigration', () => {
  test('guards table creation and appends custom DDL', () => {
    const result = postprocessMigration(
      'CREATE TABLE `widget` (`id` blob PRIMARY KEY);\n'
      , [triggerEntry])

    expect(result).toContain('CREATE TABLE IF NOT EXISTS `widget`')
    expect(result).toContain('DROP TRIGGER IF EXISTS `widget_updated`;')
    expect(result).toContain('CREATE TRIGGER IF NOT EXISTS `widget_updated`')
  })
})

describe('rebuilt tables', () => {
  test('re-adds the updated_at trigger for tables drizzle-kit recreated', () => {
    const trigger =
      { key: 'trigger:note', kind: 'trigger' as const, name: 'note_updated'
      , sql: 'CREATE TRIGGER `note_updated` AFTER UPDATE ON `note` BEGIN SELECT 1; END'
      , dropSql: 'DROP TRIGGER IF EXISTS `note_updated`;' }
    const other = { ...trigger, key: 'trigger:tag', name: 'tag_updated' }
    const sql =
      'CREATE TABLE `__new_note` (`id` blob);\nALTER TABLE `__new_note` RENAME TO `note`;'

    const result = postprocessMigration(sql, [], [trigger, other])
    expect(result).toContain('CREATE TRIGGER `note_updated`')
    expect(result).not.toContain('tag_updated')
  })
})

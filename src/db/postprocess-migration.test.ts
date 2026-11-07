import { describe, expect, test } from 'bun:test'
import type { CustomDdlEntry } from './custom-ddl.ts'
import
  { addIfNotExists
  , appendCustomDdl
  , postprocessMigration
  } from './postprocess-migration.ts'

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

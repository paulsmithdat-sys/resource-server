import { describe, expect, test } from 'bun:test'
import
  { buildCustomDdl
  , diffCustomDdl
  , emptyCustomDdlState
  , hashDdl
  , removedCustomDdl
  , sortHashes
  , stateFromEntries
  } from '../../../src/db/custom-ddl.ts'
import { buildSchema } from '../../../src/db/build-schema.ts'
import type { JSONSchema, LoadedSchema } from '../../../src/db/schema-types.ts'

const loadedSchema =
  (schema: JSONSchema): LoadedSchema => (
    { schema
    , source: `/test/${schema.title}.ts`
    , importPath: `src/schema/${schema.title}.ts`
    , exportName: `${schema.title}Schema`
    })

const built = buildSchema(
  [ loadedSchema({ title: 'Widget', type: 'object', properties: {} })
  , loadedSchema({ title: 'Gadget', type: 'object', properties: {} })
  ])

describe('buildCustomDdl', () => {
  test('creates trigger and view entries in deterministic order', () => {
    const entries = buildCustomDdl(built)
    expect(entries.map(x => x.key)).toEqual(
      [ 'trigger:gadget'
      , 'trigger:widget'
      , 'view:gadget_view'
      , 'view:widget_view'
      ])
    expect(entries[0]!.name).toBe('gadget_updated')
    expect(entries[0]!.dropSql).toBe('DROP TRIGGER IF EXISTS `gadget_updated`;')
  })
})

describe('custom DDL state', () => {
  test('hashes are stable and state round-trips', () => {
    const entries = buildCustomDdl(built)
    const state = stateFromEntries(entries)

    expect(state.version).toBe(1)
    expect(state.hashes['trigger:widget']).toBe(hashDdl(entries[1]!.sql))
    expect(diffCustomDdl(entries, state)).toEqual([])
  })

  test('detects new, changed, and removed entries', () => {
    const entries = buildCustomDdl(built)
    const empty = emptyCustomDdlState()
    expect(diffCustomDdl(entries, empty)).toEqual(entries)

    const state = stateFromEntries(entries)
    const changed =
      entries.map(x =>
        x.key === 'trigger:widget'
          ? { ...x, sql: `${x.sql}\n-- changed` }
          : x)
    expect(diffCustomDdl(changed, state).map(x => x.key))
      .toEqual(['trigger:widget'])
  })

  test('turns removed entries into drop statements', () => {
    const entries = buildCustomDdl(built)
    const state =
      { version: 1 as const
      , hashes:
          { ...stateFromEntries(entries).hashes
          , 'view:key_view': hashDdl('CREATE VIEW `key_view` AS SELECT 1;')
          , 'trigger:old_table': hashDdl('CREATE TRIGGER `old_table_updated`;')
          }
      }

    const removed = removedCustomDdl(entries, state)
    expect(removed).toEqual(
      [ { key: 'trigger:old_table'
        , kind: 'trigger'
        , name: 'old_table_updated'
        , sql: ''
        , dropSql: 'DROP TRIGGER IF EXISTS `old_table_updated`;'
        }
      , { key: 'view:key_view'
        , kind: 'view'
        , name: 'key_view'
        , sql: ''
        , dropSql: 'DROP VIEW IF EXISTS `key_view`;'
        }
      ])
  })

  test('sorts hashes for stable file output', () => {
    expect(sortHashes({ b: '2', a: '1' })).toEqual({ a: '1', b: '2' })
  })
})

import { describe, expect, test } from 'bun:test'
import
  { buildCustomDdl
  , diffCustomDdl
  , emptyCustomDdlState
  , hashDdl
  , sortHashes
  , stateFromEntries
  } from './custom-ddl.ts'
import { buildSchema } from './build-schema.ts'
import type { JSONSchema, LoadedSchema } from './schema-types.ts'

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
  test('creates one trigger entry per table in deterministic order', () => {
    const entries = buildCustomDdl(built)
    expect(entries.map(x => x.key)).toEqual(
      ['trigger:gadget', 'trigger:widget'])
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

  test('sorts hashes for stable file output', () => {
    expect(sortHashes({ b: '2', a: '1' })).toEqual({ a: '1', b: '2' })
  })
})

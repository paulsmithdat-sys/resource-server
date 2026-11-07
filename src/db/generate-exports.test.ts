import { describe, expect, test } from 'bun:test'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { buildSchema } from './build-schema.ts'
import { buildExportsSource, writeExports } from './generate-exports.ts'
import type { JSONSchema, LoadedSchema } from './schema-types.ts'

const loadedSchema =
  (schema: JSONSchema): LoadedSchema => (
    { schema
    , source: `/test/${schema.title}.ts`
    , importPath: `src/schema/${schema.title}.ts`
    , exportName: `${schema.title}Schema`
    })

const schemas =
  [ loadedSchema({ title: 'Zebra', type: 'object', properties: {} })
  , loadedSchema({ title: 'Apple', type: 'object', properties: {} })
  ]

const built = buildSchema(schemas)
const exportPath = '/tmp/opencode/serber-test/.drizzleExports/index.ts'
const projectExportPath = '/tmp/opencode/serber-test/.drizzleExports/index.ts'

describe('buildExportsSource', () => {
  test('is deterministic regardless of input order', () => {
    const a = buildExportsSource(built, schemas, projectExportPath)
    const b = buildExportsSource(built, [...schemas].reverse(), projectExportPath)
    expect(a).toBe(b)
  })

  test('imports schemas and exports one table per resource', () => {
    const source = buildExportsSource(built, schemas, projectExportPath)
    expect(source).toContain('import { AppleSchema as input0 }')
    expect(source).toContain('import { ZebraSchema as input1 }')
    expect(source).toContain('export const Apple = builtSchema.tables[\'Apple\'].drizzleSchema')
    expect(source).toContain('export const Zebra = builtSchema.tables[\'Zebra\'].drizzleSchema')
    expect(source).not.toContain("import { tables }")
  })

  test('rejects export names that are not identifiers', () => {
    const invalid =
      [ loadedSchema({ title: '123 Widget', type: 'object', properties: {} }) ]
    expect(() => buildExportsSource(
      buildSchema(invalid), invalid, projectExportPath))
      .toThrow('not a valid identifier')
  })
})

describe('writeExports', () => {
  test('writes once and reports no change on the second run', async () => {
    const dir = await mkdtemp('/tmp/opencode/serber-exports-')
    const path = join(dir, '.drizzleExports/index.ts')

    try {
      const first = await writeExports(built, schemas, path)
      const content = await readFile(path, 'utf8')

      const second = await writeExports(built, schemas, path)
      const secondContent = await readFile(path, 'utf8')

      expect(first.changed).toBe(true)
      expect(second.changed).toBe(false)
      expect(secondContent).toBe(content)
      expect(content).toBe(
        buildExportsSource(built, schemas, path))
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})

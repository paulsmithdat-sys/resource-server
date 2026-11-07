import { describe, expect, test } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { buildSchema } from './build-schema.ts'
import
  { buildCustomDdl
  , diffCustomDdl
  , stateFromEntries
  } from './custom-ddl.ts'
import { writeExports } from './generate-exports.ts'
import { loadSchemas } from './load-schemas.ts'

describe('generation idempotency', () => {
  test('two identical runs produce identical output and no custom DDL changes', async () => {
    const dir = await mkdtemp('/tmp/opencode/serber-idempotency-')
    const exportPath = join(dir, '.drizzleExports/index.ts')

    try {
      const firstSchemas = await loadSchemas()
      const firstBuilt = buildSchema(firstSchemas)
      const firstWrite = await writeExports(firstBuilt, firstSchemas, exportPath)
      const firstState = stateFromEntries(buildCustomDdl(firstBuilt))

      const secondSchemas = await loadSchemas()
      const secondBuilt = buildSchema(secondSchemas)
      const secondWrite = await writeExports(secondBuilt, secondSchemas, exportPath)

      expect(firstWrite.changed).toBe(true)
      expect(secondWrite.changed).toBe(false)
      expect(diffCustomDdl(buildCustomDdl(secondBuilt), firstState)).toEqual([])

      expect(secondBuilt.orderedTables.map(x => x.tableName)).toEqual(
        ['article', 'group', 'key', 'schema', 'tag', 'user'])
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})

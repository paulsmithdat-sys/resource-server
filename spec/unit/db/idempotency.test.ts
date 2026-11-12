import { describe, expect, test } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { buildSchema } from '../../../src/db/build-schema.ts'
import
  { buildCustomDdl
  , diffCustomDdl
  , stateFromEntries
  } from '../../../src/db/custom-ddl.ts'
import { writeExports } from '../../../src/db/generate-exports.ts'
import { loadSchemas } from '../../../src/db/load-schemas.ts'

describe('generation idempotency', () => {
  test('two identical runs produce identical output and no custom DDL changes', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'serber-idempotency-'))
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
        [ 'article'
        , 'article_tag'
        , 'audit_log'
        , 'auth_limit'
        , 'chat'
        , 'chat_share'
        , 'feedback'
        , 'key'
        , 'message'
        , 'note'
        , 'note_share'
        , 'payment'
        , 'request_nonce'
        , 'schema'
        , 'tag'
        , 'user'
        , 'user_group'
        , 'user_group_membership'
        , 'user_role'
        ])
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})

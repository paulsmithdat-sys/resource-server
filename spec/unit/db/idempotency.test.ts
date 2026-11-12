import { describe, expect, test } from 'bun:test'
import { mkdtemp, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { generateMigrations } from '../../../src/db/generate-migration.ts'
import { loadSchemas } from '../../../src/db/load-schemas.ts'

describe('generation idempotency', () => {
  test('a second run with the same schemas writes no migration', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'serber-idempotency-'))

    try {
      const first = await generateMigrations(dir, await loadSchemas())
      const second = await generateMigrations(dir, await loadSchemas())

      expect(first.migration).toBeDefined()
      expect(second.migration).toBeUndefined()
      expect((await readdir(dir)).filter(x => x !== 'schema-state.json')).toHaveLength(1)

      expect(second.built.orderedTables.map(x => x.tableName)).toEqual(
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

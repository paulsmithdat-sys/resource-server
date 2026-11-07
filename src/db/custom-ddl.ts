import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import type { BuiltSchema } from './schema-types.ts'

export type CustomDdlEntry =
  { key: string
  , kind: 'trigger' | 'view'
  , name: string
  , sql: string
  , dropSql: string
  }

export type CustomDdlState =
  { version: 1
  , hashes: Record<string, string>
  }

export const emptyCustomDdlState =
  (): CustomDdlState => ({ version: 1, hashes: {} })

export const hashDdl =
  (sql: string) => createHash('sha256').update(sql).digest('hex')

export const buildCustomDdl =
  (built: BuiltSchema): CustomDdlEntry[] =>
    built.orderedTables.map(table => (
      { key: `trigger:${table.tableName}`
      , kind: 'trigger'
      , name: `${table.tableName}_updated`
      , sql: table.trigger
      , dropSql: `DROP TRIGGER IF EXISTS \`${table.tableName}_updated\`;`
      }))

export const sortHashes =
  (hashes: Record<string, string>) =>
    Object.fromEntries(
      Object.entries(hashes).sort(([a], [b]) => a.localeCompare(b)))

export const readCustomDdlState =
  async (path: string): Promise<CustomDdlState> => {
    try {
      const parsed = JSON.parse(await readFile(path, 'utf8')) as Partial<CustomDdlState>
      if (parsed.version === 1 && parsed.hashes && typeof parsed.hashes === 'object')
        return { version: 1, hashes: parsed.hashes }
    } catch {
      // Missing or invalid state is treated as empty.
    }
    return emptyCustomDdlState()
  }

export const writeCustomDdlState =
  async (path: string, state: CustomDdlState) => {
    await mkdir(dirname(path), { recursive: true })
    await writeFile(
      path
      , JSON.stringify({ version: 1, hashes: sortHashes(state.hashes) }, null, 2) + '\n'
      , 'utf8')
  }

export const stateFromEntries =
  (entries: CustomDdlEntry[]): CustomDdlState => (
    { version: 1
    , hashes:
        Object.fromEntries(entries.map(x => [x.key, hashDdl(x.sql)]))
    })

export const diffCustomDdl =
  (entries: CustomDdlEntry[], state: CustomDdlState) =>
    entries.filter(x => state.hashes[x.key] !== hashDdl(x.sql))

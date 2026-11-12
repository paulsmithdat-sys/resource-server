import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { buildSchema } from './build-schema.ts'
import { loadSchemas } from './load-schemas.ts'
import { BREAKPOINT, databaseObjects, planMigration, stateOf, type ObjectState } from './migration-plan.ts'
import type { LoadedSchema } from './schema-types.ts'

const STATE_FILE = 'schema-state.json'

const readState =
  async (path: string): Promise<ObjectState> =>
    JSON.parse(await readFile(path, 'utf8').catch(() => '{}'))

/** Write a new migration for whatever changed since the last one, or nothing if the schemas are unchanged. */
export const generateMigrations =
  async (migrationsDir: string, loaded: LoadedSchema[]) => {
    const built = buildSchema(loaded)
    const statePath = join(migrationsDir, STATE_FILE)
    const recorded = await readState(statePath)
    const wanted = databaseObjects(built)
    const statements = planMigration(wanted, recorded).map(x => x.replace(/;\s*$/, ''))

    if (statements.length === 0) {
      console.log('No schema changes.')
      return { migration: undefined, built }
    }

    const existing = await readdir(migrationsDir).catch(() => [])
    const stamp = new Date().toISOString().replace(/\D/g, '').slice(0, 17)
    const migration = `${stamp}_${existing.length === 0 ? 'initial' : 'auto'}`
    await mkdir(join(migrationsDir, migration), { recursive: true })
    await writeFile(
      join(migrationsDir, migration, 'migration.sql')
      , statements.join(`;\n${BREAKPOINT}\n`) + ';\n')
    await writeFile(statePath, JSON.stringify(stateOf(wanted), null, 2) + '\n')

    console.log(`Migration ${migration}: ${statements.length} statement(s).`)
    return { migration, built }
  }

if (import.meta.main) {
  const loaded = await loadSchemas({ schemaDir: process.env.SCHEMA_DIR })
  generateMigrations(join(import.meta.dir, '../../.migrations'), loaded).catch(error => {
    console.error(error)
    process.exitCode = 1
  })
}

import { execFileSync } from 'node:child_process'
import { access, readdir, readFile } from 'node:fs/promises'
import { writeIfChanged } from './fs.ts'
import { dirname, join } from 'node:path'
import { buildSchema } from './build-schema.ts'
import
  { buildCustomDdl
  , diffCustomDdl
  , readCustomDdlState
  , removedCustomDdl
  , stateFromEntries
  , writeCustomDdlState
  } from './custom-ddl.ts'
import { writeExports } from './generate-exports.ts'
import { loadSchemas } from './load-schemas.ts'
import { postprocessMigration } from './postprocess-migration.ts'
import type { LoadedSchema } from './schema-types.ts'

export type GeneratePaths =
  { migrationsDir: string
  , exportPath: string
  , drizzleConfig: string
  }

const drizzleKitBin =
  () =>
    // Purpose: path of the drizzle-kit executable installed next to this package
    join(dirname(Bun.resolveSync('drizzle-kit', import.meta.dir)), 'bin.cjs')

const listMigrationDirs =
  async (migrationsDir: string) => {
    let entries
    try {
      entries = await readdir(migrationsDir, { withFileTypes: true })
    } catch {
      return []
    }

    const result: string[] = []
    for (const entry of entries) {
      if (!entry.isDirectory()) continue
      try {
        await access(join(migrationsDir, entry.name, 'migration.sql'))
        result.push(entry.name)
      } catch {
        // Not a migration directory.
      }
    }
    return result.sort()
  }

const runDrizzleGenerate =
  (paths: GeneratePaths, name: string, custom = false) => {
    // Purpose: run `drizzle-kit generate` with the given config, producing one migration
    const args =
      [ drizzleKitBin()
      , 'generate'
      , '--config'
      , paths.drizzleConfig
      , '--name'
      , name
      ]
    if (custom) args.push('--custom')

    console.log(`> drizzle-kit ${args.slice(1).join(' ')}`)
    execFileSync(process.execPath, args, { cwd: process.cwd(), stdio: 'inherit' })
  }

export const generateMigrations =
  async (paths: GeneratePaths, loaded: LoadedSchema[]) => {
    // Purpose: write the drizzle exports and any new migration for the schemas, idempotently
    const { migrationsDir, exportPath } = paths
    const statePath = join(migrationsDir, 'custom-ddl-state.json')
    const built = buildSchema(loaded)
    const exportsResult = await writeExports(built, loaded, exportPath)

    console.log(
      `Loaded ${built.orderedTables.length} schema(s); exports ${exportsResult.changed ? 'updated' : 'unchanged'}.`)

    const before = await listMigrationDirs(migrationsDir)
    const baseline = before.length === 0
    runDrizzleGenerate(paths, baseline ? 'initial' : 'auto')

    const after = await listMigrationDirs(migrationsDir)
    const newDirs = after.filter(dir => !before.includes(dir))

    const desired = buildCustomDdl(built)
    const previous = await readCustomDdlState(statePath)
    const changed =
      [ ...diffCustomDdl(desired, previous)
      , ...removedCustomDdl(desired, previous)
      ]
    const stateChanged = changed.length > 0

    let targetDir = newDirs.at(-1)

    if (!targetDir && changed.length > 0) {
      const beforeCustom = await listMigrationDirs(migrationsDir)
      runDrizzleGenerate(paths, 'custom', true)
      const afterCustom = await listMigrationDirs(migrationsDir)
      targetDir = afterCustom.filter(dir => !beforeCustom.includes(dir)).at(-1)
    }

    if (targetDir) {
      const migrationPath = join(migrationsDir, targetDir, 'migration.sql')
      const existing = await readFile(migrationPath, 'utf8')
      const next = postprocessMigration(existing, changed, desired)
      await writeIfChanged(migrationPath, next)
      console.log(
        `Migration ${targetDir}: ${changed.length} custom DDL group(s) applied.`)

      if (stateChanged)
        await writeCustomDdlState(statePath, stateFromEntries(desired))
      return { migration: targetDir, built }
    }

    if (stateChanged)
      await writeCustomDdlState(statePath, stateFromEntries(desired))

    console.log('No schema changes.')
    return { migration: undefined, built }
  }

if (import.meta.main) {
  const root = join(import.meta.dir, '../..')
  const loaded = await loadSchemas({ schemaDir: process.env.SCHEMA_DIR })
  generateMigrations(
    { migrationsDir: join(root, '.drizzle')
    , exportPath: join(root, '.drizzleExports/index.ts')
    , drizzleConfig: join(root, 'drizzle.config.ts')
    }, loaded).catch(error => {
      console.error(error)
      process.exitCode = 1
    })
}

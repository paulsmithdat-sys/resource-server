import { execFileSync } from 'node:child_process'
import { access, readdir, readFile } from 'node:fs/promises'
import { writeIfChanged } from './fs.ts'
import { join } from 'node:path'
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

const projectRoot = join(import.meta.dir, '../..')
const migrationsDir = join(projectRoot, '.drizzle')
const exportPath = join(projectRoot, '.drizzleExports/index.ts')
const drizzleConfig = join(projectRoot, 'drizzle.config.ts')
const statePath = join(migrationsDir, 'custom-ddl-state.json')

const listMigrationDirs =
  async () => {
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
  (name: string, custom = false) => {
    const args =
      [ '--bun'
      , 'drizzle-kit'
      , 'generate'
      , '--config'
      , drizzleConfig
      , '--name'
      , name
      ]
    if (custom) args.push('--custom')

    console.log(`> bunx ${args.join(' ')}`)
    execFileSync('bunx', args, { cwd: projectRoot, stdio: 'inherit' })
  }

const main =
  async () => {
    const loaded = await loadSchemas(
      { schemaDir: process.env.SCHEMA_DIR })
    const built = buildSchema(loaded)
    const exportsResult = await writeExports(built, loaded, exportPath)

    console.log(
      `Loaded ${built.orderedTables.length} schema(s); exports ${exportsResult.changed ? 'updated' : 'unchanged'}.`)

    const before = await listMigrationDirs()
    const baseline = before.length === 0
    runDrizzleGenerate(baseline ? 'initial' : 'auto')

    const after = await listMigrationDirs()
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
      const beforeCustom = await listMigrationDirs()
      runDrizzleGenerate('custom', true)
      const afterCustom = await listMigrationDirs()
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
      return
    }

    if (stateChanged)
      await writeCustomDdlState(statePath, stateFromEntries(desired))

    console.log('No schema changes.')
  }

main().catch(error => {
  console.error(error)
  process.exitCode = 1
})

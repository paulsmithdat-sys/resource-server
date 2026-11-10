import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { join, relative, resolve } from 'node:path'
import * as opaque from '@serenity-kit/opaque'
import { generateMigrations } from './db/generate-migration.ts'
import { writeIfChanged } from './db/fs.ts'
import { loadSchemas } from './db/load-schemas.ts'
import type { LoadedSchema } from './db/schema-types.ts'
import { openDatabase } from './db/open.ts'
import { createServerApp } from './server/start.ts'

export const defaultDir = '.resource-server'

type ProjectConfig =
  { version: 1
  , schemas: string[]
  , schemaHash: string
  }

const configPath = (dir: string) => join(dir, 'config.json')

export const schemaHash =
  (loaded: LoadedSchema[]) => {
    // Purpose: fingerprint of everything that decides the tables, so serve can tell the schemas changed since init
    const content = loaded.map(x => [x.importPath, x.exportName, x.schema])
    return createHash('sha256').update(JSON.stringify(content)).digest('hex')
  }

const readConfig =
  async (dir: string): Promise<ProjectConfig> => {
    // Purpose: read the settings written by init, or fail with the command to run
    const text = await readFile(configPath(dir), 'utf8').catch(() => undefined)
    if (text === undefined)
      throw new Error(`No ${configPath(dir)}. Run \`resource-server init <schema…>\` first.`)
    return JSON.parse(text) as ProjectConfig
  }

const serverKey =
  async () => {
    // Purpose: the existing OPAQUE server key, or a new one only when none is set (never replace a key)
    const existing = process.env.OPAQUE_SERVER_SETUP
    if (existing) return { value: existing, created: false }
    await opaque.ready
    return { value: opaque.server.createSetup(), created: true }
  }

export const init =
  async (options: { schemas: string[], dir?: string }) => {
    // Purpose: generate the migrations for the schemas into dir, record them, and print the settings to add to .env
    const dir = resolve(options.dir ?? defaultDir)
    if (options.schemas.length === 0)
      throw new Error('Give init a schema folder or files, e.g. `resource-server init schemas`.')

    const loaded = await loadSchemas({ schemaDir: options.schemas })
    const exportPath = join(dir, 'exports.ts')
    const drizzleConfig = join(dir, 'drizzle.config.ts')

    await writeIfChanged(join(dir, '.gitignore'), 'exports.ts\ndrizzle.config.ts\n')
    await writeIfChanged(
      drizzleConfig,
      'export default '
      + JSON.stringify(
        { out: join(dir, 'migrations')
        , schema: exportPath
        , dialect: 'turso'
        , dbCredentials: { url: process.env.DB_PATH ?? '.db' }
        }, null, 2)
      + '\n')

    const { built } = await generateMigrations(
      { migrationsDir: join(dir, 'migrations'), exportPath, drizzleConfig },
      loaded)

    const config: ProjectConfig =
      { version: 1
      , schemas: options.schemas.map(x => relative(process.cwd(), resolve(x)) || '.')
      , schemaHash: schemaHash(loaded)
      }
    await writeIfChanged(configPath(dir), JSON.stringify(config, null, 2) + '\n')

    const key = await serverKey()
    console.log(`\nInitialised ${relative(process.cwd(), dir) || '.'} (${built.orderedTables.length} tables).`)
    if (key.created)
      console.log(`\nAdd this to your .env (keep it secret; changing it locks every user out):\n\n  OPAQUE_SERVER_SETUP=${key.value}\n`)
    else
      console.log('\nOPAQUE_SERVER_SETUP is already set, so it was kept.')
    console.log('Optional .env settings: DB_PATH (default .db), PORT (default 5734), SERBER_ADMINS (comma-separated usernames).')
    console.log('\nThen run `resource-server serve`. Run init again after any schema change.')
  }

export const serve =
  async (options: { dir?: string, port?: number }) => {
    // Purpose: start the server for the schemas recorded by init, refusing to run if they changed since
    const dir = resolve(options.dir ?? defaultDir)
    const config = await readConfig(dir)
    const loaded = await loadSchemas({ schemaDir: config.schemas })
    if (schemaHash(loaded) !== config.schemaHash)
      throw new Error(
        'The schemas changed since `init`. Run `resource-server init '
        + `${config.schemas.join(' ')}\` again, then serve.`)

    const app = await createServerApp(
      { loaded
      , db: await openDatabase()
      , migrationsFolder: join(dir, 'migrations')
      })
    const port = options.port ?? Number(process.env.PORT ?? 5734)
    const server = Bun.serve({ port, fetch: app.fetch })
    console.log(`Server listening on http://localhost:${server.port}`)
    return server
  }

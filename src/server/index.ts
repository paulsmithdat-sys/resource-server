import 'dotenv/config'
import { buildSchema } from '../db/build-schema.ts'
import { loadSchemas } from '../db/load-schemas.ts'
import { applyMigrations } from '../db/migrate.ts'
import { db } from '../helper/loadDb.ts'
import { createApp } from './app.ts'
import { createRowDatabase } from './database.ts'

const opaqueServerSetup = process.env.OPAQUE_SERVER_SETUP
if (!opaqueServerSetup)
  throw new Error(
    'OPAQUE_SERVER_SETUP is required. '
    + 'Generate one with `bunx @serenity-kit/opaque create-server-setup`.')

// Bring the database up to date before serving; a failure stops the server.
if (process.env.MIGRATE_ON_START !== 'false') await applyMigrations(db)

const built = buildSchema(
  await loadSchemas({ schemaDir: process.env.SCHEMA_DIR }))
const app =
  createApp(
    { built
    , db: createRowDatabase(db)
    , opaqueServerSetup
    , requireSession: true
    , admins: (process.env.SERBER_ADMINS ?? '').split(',').map(x => x.trim()).filter(Boolean)
    })
const port = Number(process.env.PORT ?? process.env.ELYSIA_PORT ?? 5734)

console.log(`Server listening on http://localhost:${port}`)

export default { port, fetch: app.fetch }

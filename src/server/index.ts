import 'dotenv/config'
import { buildSchema } from '../db/build-schema.ts'
import { loadSchemas } from '../db/load-schemas.ts'
import { db } from '../helper/loadDb.ts'
import { createApp } from './app.ts'
import { createRowDatabase } from './database.ts'

const opaqueServerSetup = process.env.OPAQUE_SERVER_SETUP
if (!opaqueServerSetup)
  throw new Error(
    'OPAQUE_SERVER_SETUP is required. '
    + 'Generate one with `bunx @serenity-kit/opaque create-server-setup`.')

const built = buildSchema(await loadSchemas())
const app =
  createApp(
    { built
    , db: createRowDatabase(db)
    , opaqueServerSetup
    })
const port = Number(process.env.ELYSIA_PORT ?? 5734)

console.log(`Server listening on http://localhost:${port}`)

export default { port, fetch: app.fetch }

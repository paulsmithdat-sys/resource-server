import 'dotenv/config'
import { loadSchemas } from '../db/load-schemas.ts'
import { migrationsFolder } from '../db/migrate.ts'
import { db } from '../helper/loadDb.ts'
import { createServerApp } from './start.ts'

const app =
  await createServerApp(
    { loaded: await loadSchemas({ schemaDir: process.env.SCHEMA_DIR })
    , db
    , migrationsFolder
    })
const port = Number(process.env.PORT ?? process.env.ELYSIA_PORT ?? 5734)

console.log(`Server listening on http://localhost:${port}`)

export default { port, fetch: app.fetch }

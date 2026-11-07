import { buildSchema } from '../db/build-schema.ts'
import { loadSchemas } from '../db/load-schemas.ts'
import { createApp } from './app.ts'
import { tursoDatabase } from './database.ts'

const built = buildSchema(await loadSchemas())
const app = createApp({ built, db: tursoDatabase })
const port = Number(process.env.ELYSIA_PORT ?? 5734)

console.log(`Serber listening on http://localhost:${port}`)

export default { port, fetch: app.fetch }

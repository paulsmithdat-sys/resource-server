import 'dotenv/config'
import { defineConfig } from 'drizzle-kit'

export const dbPath = process.env.DB_PATH ?? '.db'

export default defineConfig(
  { out: './.drizzle'
  , schema: './.drizzleExports/index.ts'
  , dialect: 'turso'
  , dbCredentials:
    { url: dbPath
    }
  })

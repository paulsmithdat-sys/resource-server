import 'dotenv/config'
import { defineConfig } from 'drizzle-kit'

export default defineConfig(
  { out: './.drizzle'
  , schema: './.drizzleExports/index.ts'
  , dialect: 'turso'
  , dbCredentials:
    { url: '.db' //process.env.DB_FILE_NAME!
    }
  })

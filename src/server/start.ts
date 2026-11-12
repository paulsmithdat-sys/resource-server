import { buildSchema } from '../db/build-schema.ts'
import { applyMigrations } from '../db/migrate.ts'
import type { LoadedSchema } from '../db/schema-types.ts'
import type { Database } from '../db/open.ts'
import { createApp } from './app/index.ts'
import { createRowDatabase } from './database.ts'

export const createServerApp =
  async (options: { loaded: LoadedSchema[], db: Database, migrationsFolder: string }) => {
    // Purpose: migrate the database, then build the HTTP app from the environment settings
    const opaqueServerSetup = process.env.OPAQUE_SERVER_SETUP
    if (!opaqueServerSetup)
      throw new Error(
        'OPAQUE_SERVER_SETUP is required. '
        + 'Run `resource-server init` and add the value it prints to .env.')

    // Bring the database up to date before serving; a failure stops the server.
    if (process.env.MIGRATE_ON_START !== 'false')
      await applyMigrations(options.db, options.migrationsFolder)

    return createApp(
      { built: buildSchema(options.loaded)
      , db: createRowDatabase(options.db)
      , opaqueServerSetup
      , requireSession: true
      , admins: (process.env.SERBER_ADMINS ?? '').split(',').map(x => x.trim()).filter(Boolean)
      })
  }

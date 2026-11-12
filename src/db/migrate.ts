import { join } from 'node:path'
import { drizzle } from 'drizzle-orm/tursodatabase/database'
import { migrate } from 'drizzle-orm/tursodatabase/migrator'
import type { Database } from './open.ts'

export const migrationsFolder = join(import.meta.dir, '../../.drizzle')

export const applyMigrations =
  async (client: Database, folder = migrationsFolder) => {
    // Purpose: apply every migration not yet recorded in the database (the same record drizzle-kit migrate uses)
    const result = await migrate(drizzle({ client }), { migrationsFolder: folder })
    if (result)
      throw new Error(`Migrations could not be applied: ${JSON.stringify(result)}`)
  }

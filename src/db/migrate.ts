import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { BREAKPOINT } from './migration-plan.ts'
import { openDatabase, type Database } from './open.ts'

export const migrationsFolder = join(import.meta.dir, '../../.migrations')

/** Apply every migration not yet recorded in the database, each in one transaction. */
export const applyMigrations =
  async (client: Database, folder = migrationsFolder) => {
    await client.exec(
      'CREATE TABLE IF NOT EXISTS `__migrations` (`name` text PRIMARY KEY, `applied_at` integer NOT NULL)')
    const applied =
      new Set(
        (await (await client.prepare('SELECT name FROM `__migrations`')).all())
          .map(x => x.name as string))
    const names =
      (await readdir(folder, { withFileTypes: true }))
        .filter(x => x.isDirectory() && !applied.has(x.name))
        .map(x => x.name)
        .sort()

    // Foreign keys stay off while tables are rebuilt, or deleting the old table would cascade.
    await client.exec('PRAGMA foreign_keys = OFF')
    try {
      for (const name of names) {
        const sql = await readFile(join(folder, name, 'migration.sql'), 'utf8')
        await client.exec('BEGIN')
        try {
          for (const statement of sql.split(BREAKPOINT))
            if (statement.trim()) await client.exec(statement)
          await (await client.prepare(
            'INSERT INTO `__migrations` (`name`, `applied_at`) VALUES (?, ?)'))
            .run(name, Date.now())
          await client.exec('COMMIT')
        } catch (error) {
          await client.exec('ROLLBACK')
          throw error
        }
      }
    } finally {
      await client.exec('PRAGMA foreign_keys = ON')
    }
  }

if (import.meta.main)
  await applyMigrations(await openDatabase())

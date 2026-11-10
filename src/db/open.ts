import { connect } from '@tursodatabase/database'
import type { DatabaseOpts } from '@tursodatabase/database-common'

const options: DatabaseOpts =
  { experimental: ['views', 'custom_types', 'encryption', 'vacuum'] }

export const openDatabase =
  async (path = process.env.DB_PATH ?? '.db') => {
    // Purpose: open the database file with foreign keys enforced
    const db = await connect(path, options)
    await db.exec('PRAGMA foreign_keys = ON')
    return db
  }

import { readFile, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { connect } from '@tursodatabase/database'
import type { Hono } from 'hono'
import { buildSchema } from '../../src/db/build-schema.ts'
import { loadSchemas } from '../../src/db/load-schemas.ts'
import { createApp } from '../../src/server/app.ts'
import { createRowDatabase } from '../../src/server/database.ts'
import { seedDocuments } from '../../src/seed/index.ts'

export const JSON_API = 'application/vnd.api+json'

const drizzleRoot = join(import.meta.dir, '../../.drizzle')

const latestMigration =
  async () => {
    const entries = await readdir(drizzleRoot, { withFileTypes: true })
    const directories =
      entries
        .filter(x => x.isDirectory())
        .map(x => x.name)
        .sort()

    const latest = directories.at(-1)
    if (!latest)
      throw new Error(`No migrations found in ${drizzleRoot}`)

    return await readFile(join(drizzleRoot, latest, 'migration.sql'), 'utf8')
  }

export const applyMigrations =
  async (db: { exec: (sql: string) => Promise<void> }) => {
    const sql = await latestMigration()
    for (const statement of sql.split('--> statement-breakpoint')) {
      const trimmed = statement.trim()
      if (trimmed) await db.exec(trimmed)
    }
  }

export const createTestServer =
  async () => {
    const connection =
      await connect(
        ':memory:'
        , { experimental: ['views', 'custom_types', 'encryption', 'vacuum'] })
    await applyMigrations(connection)

    const db = createRowDatabase(connection)
    const built = buildSchema(await loadSchemas())
    const app = createApp({ built, db })

    return { app, db, built, connection }
  }

export const postDocument =
  async (app: Hono, document: unknown) => {
    const data =
      typeof document === 'object' && document !== null && 'type' in document
        ? document as { type: string }
        : undefined
    if (!data)
      throw new Error('Seed document must have a type')

    return app.request(
      `/${data.type}`
      , { method: 'POST'
        , headers: { 'content-type': JSON_API, accept: JSON_API }
        , body: JSON.stringify({ data: document })
        })
  }

export const seedDatabase =
  async (app: Hono) => {
    for (const document of seedDocuments) {
      const response = await postDocument(app, document)
      if (response.status !== 201) {
        throw new Error(
          `Failed to seed ${document.type}: ${response.status} `
          + await response.text())
      }
    }
  }

import { readFile, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import * as opaque from '@serenity-kit/opaque'
import { connect } from '@tursodatabase/database'
import type { Hono } from 'hono'
import { buildSchema } from '../../src/db/build-schema.ts'
import { loadSchemas } from '../../src/db/load-schemas.ts'
import { createApp } from '../../src/server/app.ts'
import { createRowDatabase } from '../../src/server/database.ts'
import { seedDocuments } from '../../src/seed/index.ts'

export const JSON_API = 'application/vnd.api+json'

await opaque.ready

export const opaqueServerSetup =
  process.env.OPAQUE_SERVER_SETUP ?? opaque.server.createSetup()

const drizzleRoot = join(import.meta.dir, '../../.drizzle')

const migrationSql =
  async () => {
    const entries = await readdir(drizzleRoot, { withFileTypes: true })
    const directories =
      entries
        .filter(x => x.isDirectory())
        .map(x => x.name)
        .sort()

    if (directories.length === 0)
      throw new Error(`No migrations found in ${drizzleRoot}`)

    const statements: string[] = []
    for (const directory of directories) {
      const sql =
        await readFile(join(drizzleRoot, directory, 'migration.sql'), 'utf8')
      for (const statement of sql.split('--> statement-breakpoint')) {
        const trimmed = statement.trim()
        if (trimmed) statements.push(trimmed)
      }
    }
    return statements
  }

export const applyMigrations =
  async (db: { exec: (sql: string) => Promise<void> }) => {
    for (const statement of await migrationSql())
      await db.exec(statement)
  }

export const createTestServer =
  async (options: { auth?: boolean, session?: boolean } = {}) => {
    const connection =
      await connect(
        ':memory:'
        , { experimental: ['views', 'custom_types', 'encryption', 'vacuum'] })
    await connection.exec('PRAGMA foreign_keys = ON')
    await applyMigrations(connection)

    const db = createRowDatabase(connection)
    const built = buildSchema(await loadSchemas())
    const app =
      options.auth === false
        ? createApp({ built, db })
        : createApp(
          { built
          , db
          , opaqueServerSetup
          , requireSession: options.session === true
          })

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

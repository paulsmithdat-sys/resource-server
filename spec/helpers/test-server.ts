import * as opaque from '@serenity-kit/opaque'
import { connect } from '@tursodatabase/database'
import type { Hono } from 'hono'
import { buildSchema } from '../../src/db/build-schema.ts'
import { loadSchemas } from '../../src/db/load-schemas.ts'
import { applyMigrations } from '../../src/db/migrate.ts'
import { createApp } from '../../src/server/app/index.ts'
import { createRowDatabase } from '../../src/server/database.ts'
import { seedDocuments } from '../../src/seed/index.ts'

export const JSON_API = 'application/vnd.api+json'

await opaque.ready

export const opaqueServerSetup =
  process.env.OPAQUE_SERVER_SETUP ?? opaque.server.createSetup()

export const createTestServer =
  async (options: { auth?: boolean, session?: boolean, admins?: string[] } = {}) => {
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
          , admins: options.admins
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

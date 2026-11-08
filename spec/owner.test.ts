import { describe, expect, test } from 'bun:test'
import { getTableConfig } from 'drizzle-orm/sqlite-core'
import { uuidToBuffer } from '../src/server/uuid.ts'
import { postDocument, createTestServer } from './helpers/test-server.ts'

const documentOf =
  async (response: Response) => {
    const body = await response.json() as any
    if (!body.data) throw new Error(JSON.stringify(body))
    return body.data
  }

const createUser =
  async ( app: any
        , attributes: Record<string, unknown>) => {
    const response =
      await postDocument(app, { type: 'user', attributes })
    expect(response.status).toBe(201)
    return await documentOf(response)
  }

const createGroup =
  async (app: any, name: string) => {
    const response =
      await postDocument(app, { type: 'user_group', attributes: { name } })
    expect(response.status).toBe(201)
    return await documentOf(response)
  }

const createTag =
  async (app: any, attributes: Record<string, unknown>) =>
    await postDocument(app, { type: 'tag', attributes })

describe('owner', () => {
  test('is an exposed attribute backed by a user FK and an index', async () => {
    const { built } = await createTestServer()
    const tag = built.tables.Tag!

    expect(tag.columns.find(x => x.columnName === 'owner')?.exposed).toBe(true)
    expect(tag.foreignKeys).toContainEqual(
      { columns: ['owner']
      , foreignTable: 'user'
      , foreignColumns: ['id']
      , onDelete: 'set null'
      })

    const config = getTableConfig(tag.drizzleSchema)
    expect(
      config.indexes.some(
        index => (index.config.columns[0] as any).name === 'owner'))
      .toBe(true)
  })

  test('defaults to null when omitted', async () => {
    const { app } = await createTestServer()
    const tag = await documentOf(
      await createTag(app, { name: 'unowned', kind: 'topic' }))

    expect(tag.attributes.owner).toBeNull()
  })

  test('accepts an existing user id', async () => {
    const { app } = await createTestServer()
    const user =
      await createUser(
        app
        , { username: 'alice'
          , email: 'alice@example.com'
          , display_name: 'Alice'
          })

    const response =
      await createTag(
        app, { name: 'owned', kind: 'topic', owner: user.id })

    expect(response.status).toBe(201)
    const tag = await documentOf(response)
    expect(tag.attributes.owner).toBe(user.id)

    const read = await app.request(`/tag/${tag.id}`)
    expect((await read.json() as any).data.attributes.owner).toBe(user.id)
  })

  test('rejects groups, unknown users, and malformed ids', async () => {
    const { app } = await createTestServer()
    const group = await createGroup(app, 'editors')

    const groupOwner =
      await createTag(
        app, { name: 'group-owned', kind: 'topic', owner: group.id })
    expect(groupOwner.status).toBe(400)
    expect((await groupOwner.json() as any).errors[0].source.parameter)
      .toBe('data.attributes.owner')

    const unknownOwner =
      await createTag(
        app
        , { name: 'unknown-owned'
          , kind: 'topic'
          , owner: Bun.randomUUIDv7()
          })
    expect(unknownOwner.status).toBe(400)
    expect((await unknownOwner.json() as any).errors[0].source.parameter)
      .toBe('data.attributes.owner')

    const malformed =
      await createTag(
        app, { name: 'malformed-owned', kind: 'topic', owner: 'alice' })
    expect(malformed.status).toBe(400)
    expect((await malformed.json() as any).errors[0].source.parameter)
      .toBe('data.attributes.owner')
  })

  test('enforces the owner FK to user at the database level', async () => {
    const { app, db } = await createTestServer()
    const group = await createGroup(app, 'database-editors')

    expect(
      db.run(
        'INSERT INTO `tag` (`id`, `owner`, `name`) VALUES (?, ?, ?)'
        , [ uuidToBuffer(Bun.randomUUIDv7())
          , uuidToBuffer(group.id)
          , 'invalid'
          ]))
      .rejects.toThrow(/FOREIGN KEY constraint failed/i)
  })

  test('is set to null when the owning user is deleted', async () => {
    const { app } = await createTestServer()
    const user =
      await createUser(
        app, { username: 'alice', email: 'alice@example.com' })
    const tag = await documentOf(
      await createTag(app, { name: 'owned', kind: 'topic', owner: user.id }))

    const removed = await app.request(`/user/${user.id}`, { method: 'DELETE' })
    expect(removed.status).toBe(204)

    const read = await app.request(`/tag/${tag.id}`)
    expect((await read.json() as any).data.attributes.owner).toBeNull()
  })

  test('supports self-referencing user owners', async () => {
    const { app } = await createTestServer()
    const alice =
      await createUser(
        app, { username: 'alice', email: 'alice@example.com' })
    const bob =
      await createUser(
        app
        , { username: 'bob'
          , email: 'bob@example.com'
          , owner: alice.id
          })

    expect(bob.attributes.owner).toBe(alice.id)

    const removed = await app.request(`/user/${alice.id}`, { method: 'DELETE' })
    expect(removed.status).toBe(204)

    const read = await app.request(`/user/${bob.id}`)
    const document = await read.json() as any
    expect(document.data.attributes.owner).toBeNull()
  })
})

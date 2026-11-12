import { describe, expect, test } from 'bun:test'
import type { RowDatabase } from '../src/server/database.ts'
import { uuidToBuffer } from '../src/server/uuid.ts'
import { postDocument, createTestServer } from './helpers/test-server.ts'

const documentOf =
  async (response: Response) => {
    const body = await response.json() as any
    if (!body.data) throw new Error(JSON.stringify(body))
    return body.data
  }

/** Insert a user row directly, because the API never creates users. */
const createUser =
  async (db: RowDatabase, username: string) => {
    const id = Bun.randomUUIDv7()
    await db.run('INSERT INTO `user` (`id`, `username`) VALUES (?, ?)', [uuidToBuffer(id), username])
    return { id }
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

    expect(tag.indexes).toContain('owner')
  })

  test('defaults to null when omitted', async () => {
    const { app } = await createTestServer()
    const tag = await documentOf(
      await createTag(app, { name: 'unowned', kind: 'topic' }))

    expect(tag.attributes.owner).toBeNull()
  })

  test('ignores an owner id sent by the client', async () => {
    const { app, db } = await createTestServer()
    const user = await createUser(db, 'alice')

    for (const owner of [user.id, Bun.randomUUIDv7()]) {
      const response =
        await createTag(app, { name: `t-${String(owner)}`, kind: 'topic', owner })
      expect(response.status).toBe(201)
      expect((await documentOf(response)).attributes.owner).toBeNull()
    }
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
    const { app, db } = await createTestServer()
    const user = await createUser(db, 'alice')
    const tag = await documentOf(
      await createTag(app, { name: 'owned', kind: 'topic' }))
    await db.run(
      'UPDATE `tag` SET `owner` = ? WHERE `id` = ?'
      , [uuidToBuffer(user.id), uuidToBuffer(tag.id)])

    const removed = await app.request(`/user/${user.id}`, { method: 'DELETE' })
    expect(removed.status).toBe(204)

    const read = await app.request(`/tag/${tag.id}`)
    expect((await read.json() as any).data.attributes.owner).toBeNull()
  })
})

import { describe, expect, test } from 'bun:test'
import
  { createAs
  , resourceDocument
  , signIn
  , toMany
  , toOne
  , type SignedIn
  } from './helpers/session.ts'
import { createTestServer } from './helpers/test-server.ts'

const noteAs =
  (user: SignedIn, visibility = 'shared', title = 'Plans') => {
    // Purpose: create a note with the given visibility
    return createAs(user, 'note', { title, body: 'secret text', visibility })
  }

const share =
  ( owner: SignedIn
  , note: string
  , target: { user?: string, group?: string }
  , grant: { can_read?: boolean, can_write?: boolean } = {}) => {
    // Purpose: grant a user or group access to a note, returning the response
    return owner.request(
      'POST', '/note_share'
      , resourceDocument(
          'note_share'
          , grant
          , { note: toOne('note', note)
            , ...(target.user ? { user: toOne('user', target.user) } : {})
            , ...(target.group ? { user_group: toOne('user_group', target.group) } : {})
            }))
  }

const patchNote =
  (user: SignedIn, id: string, attributes: Record<string, unknown>) => {
    // Purpose: PATCH a note's attributes as a user
    return user.request(
      'PATCH', `/note/${id}`, { data: { type: 'note', id, attributes } })
  }

const titleOf =
  async (user: SignedIn, id: string) => {
    // Purpose: read a note's title as a user, or undefined when not visible
    const response = await user.request('GET', `/note/${id}`)
    if (response.status !== 200) return undefined
    return ((await response.json()) as any).data.attributes.title
  }

const setup =
  async () => {
    // Purpose: a server with three signed-in users
    const { app, db } = await createTestServer({ session: true })
    return (
      { app
      , db
      , alice: await signIn(app, 'alice')
      , bob: await signIn(app, 'bob')
      , carol: await signIn(app, 'carol')
      })
  }

describe('sharing with users', () => {
  test('a read share lets that user read, and only read', async () => {
    const { alice, bob, carol } = await setup()
    const note = await noteAs(alice)
    expect((await share(alice, note, { user: bob.userId })).status).toBe(201)

    expect(await titleOf(bob, note)).toBe('Plans')
    expect(await titleOf(carol, note)).toBeUndefined()
    const list = await (await bob.request('GET', '/note')).json() as any
    expect(list.data.map((x: any) => x.id)).toEqual([note])

    expect((await patchNote(bob, note, { title: 'Mine now' })).status).toBe(404)
    expect((await bob.request('DELETE', `/note/${note}`)).status).toBe(404)
    expect(await titleOf(alice, note)).toBe('Plans')
  })

  test('a write share lets that user edit; write-only cannot read it back', async () => {
    const { alice, bob } = await setup()
    const note = await noteAs(alice)
    await share(alice, note, { user: bob.userId }, { can_read: false, can_write: true })

    expect(await titleOf(bob, note)).toBeUndefined()
    const response = await patchNote(bob, note, { title: 'Edited by bob' })
    expect(response.status).toBe(204)
    expect(await response.text()).toBe('')
    expect(await titleOf(alice, note)).toBe('Edited by bob')
  })

  test('read and write together return the updated row', async () => {
    const { alice, bob } = await setup()
    const note = await noteAs(alice)
    await share(alice, note, { user: bob.userId }, { can_read: true, can_write: true })

    const response = await patchNote(bob, note, { title: 'Both' })
    expect(response.status).toBe(200)
    expect(((await response.json()) as any).data.attributes.title).toBe('Both')
  })

  test('shared writers cannot change visibility, delete, or re-share', async () => {
    const { alice, bob, carol } = await setup()
    const note = await noteAs(alice)
    await share(alice, note, { user: bob.userId }, { can_read: true, can_write: true })

    expect((await patchNote(bob, note, { visibility: 'public' })).status).toBe(403)
    expect((await bob.request('PUT', `/note/${note}`
      , { data: { type: 'note', id: note, attributes: { title: 'Put by bob' } } })).status)
      .toBe(200)
    const after = await (await alice.request('GET', `/note/${note}`)).json() as any
    expect(after.data.attributes.visibility).toBe('shared')

    expect((await bob.request('DELETE', `/note/${note}`)).status).toBe(404)
    expect((await share(bob, note, { user: carol.userId })).status).toBe(404)
    expect(await titleOf(carol, note)).toBeUndefined()
  })

  test('shares only apply while the note is marked shared', async () => {
    const { alice, bob } = await setup()
    const note = await noteAs(alice, 'private')
    await share(alice, note, { user: bob.userId })

    expect(await titleOf(bob, note)).toBeUndefined()
    expect((await patchNote(alice, note, { visibility: 'shared' })).status).toBe(200)
    expect(await titleOf(bob, note)).toBe('Plans')
  })

  test('revoking a share removes access immediately', async () => {
    const { alice, bob } = await setup()
    const note = await noteAs(alice)
    const granted = await (await share(alice, note, { user: bob.userId })).json() as any

    expect((await alice.request('DELETE', `/note_share/${granted.data.id}`)).status).toBe(204)
    expect(await titleOf(bob, note)).toBeUndefined()
  })

  test('share rows are private to the sharer', async () => {
    const { alice, bob } = await setup()
    const note = await noteAs(alice)
    const granted = await (await share(alice, note, { user: bob.userId })).json() as any

    expect((await bob.request('GET', `/note_share/${granted.data.id}`)).status).toBe(404)
    expect((await bob.request('DELETE', `/note_share/${granted.data.id}`)).status).toBe(404)
    expect(await titleOf(bob, note)).toBe('Plans')
  })

  test('rejects shares with no permission, both targets, or no target', async () => {
    const { alice, bob } = await setup()
    const note = await noteAs(alice)
    const group = await createAs(alice, 'user_group', { name: 'g1' })

    expect((await share(alice, note, { user: bob.userId }, { can_read: false, can_write: false })).status).toBe(409)
    expect((await share(alice, note, { user: bob.userId, group })).status).toBe(409)
    expect((await share(alice, note, {})).status).toBe(409)
    expect((await share(alice, note, { user: bob.userId })).status).toBe(201)
    expect((await share(alice, note, { user: bob.userId })).status).toBe(409)
  })

  test('deleting the note deletes its shares', async () => {
    const { alice, bob, db } = await setup()
    const note = await noteAs(alice)
    await share(alice, note, { user: bob.userId })

    expect((await alice.request('DELETE', `/note/${note}`)).status).toBe(204)
    const row = await db.get('SELECT COUNT(*) AS n FROM `note_share`')
    expect(Number(row?.n)).toBe(0)
  })
})

describe('sharing with groups', () => {
  test('group members get access, and lose it when removed', async () => {
    const { alice, bob, carol } = await setup()
    const group =
      await createAs(alice, 'user_group', { name: 'team' }, { users: toMany('user', [bob.userId]) })
    const note = await noteAs(alice)
    expect((await share(alice, note, { group })).status).toBe(201)

    expect(await titleOf(bob, note)).toBe('Plans')
    expect(await titleOf(carol, note)).toBeUndefined()

    const removed =
      await alice.request(
        'PATCH', `/user_group/${group}`
        , { data: { type: 'user_group', id: group, relationships: { users: toMany('user', []) } } })
    expect(removed.status).toBe(200)
    expect(await titleOf(bob, note)).toBeUndefined()
  })

  test('only the group owner can change its members', async () => {
    const { alice, bob, carol } = await setup()
    const group = await createAs(alice, 'user_group', { name: 'team' })

    const response =
      await bob.request(
        'PATCH', `/user_group/${group}`
        , { data: { type: 'user_group', id: group, relationships: { users: toMany('user', [bob.userId, carol.userId]) } } })
    expect(response.status).toBe(404)
  })

  test('read from one share and write from another combine', async () => {
    const { alice, bob } = await setup()
    const group =
      await createAs(alice, 'user_group', { name: 'editors' }, { users: toMany('user', [bob.userId]) })
    const note = await noteAs(alice)
    await share(alice, note, { user: bob.userId }, { can_read: true })
    await share(alice, note, { group }, { can_read: false, can_write: true })

    const response = await patchNote(bob, note, { title: 'Combined' })
    expect(response.status).toBe(200)
    expect(((await response.json()) as any).data.attributes.title).toBe('Combined')
  })
})

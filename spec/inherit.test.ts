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

const json =
  async (response: Response) => await response.json() as any

/** Post a message into a chat, returning the response. */
const post =
  (user: SignedIn, chat: string, text: string) => {
    return user.request(
      'POST', '/message'
      , resourceDocument('message', { text }, { chat: toOne('chat', chat) }))
  }

/** List the message texts a user can see. */
const texts =
  async (user: SignedIn, path = '/message?sort=text') => {
    const response = await user.request('GET', path)
    if (response.status !== 200) return response.status
    return ((await json(response)).data as any[]).map(x => x.attributes.text).sort()
  }

/** Alice's chat shared with a group containing bob; carol is outside it. */
const setup =
  async (grant: Record<string, boolean> = { can_read: true, can_write: true }) => {
    const { app } = await createTestServer({ session: true })
    const alice = await signIn(app, 'alice')
    const bob = await signIn(app, 'bob')
    const carol = await signIn(app, 'carol')
    const group =
      await createAs(alice, 'user_group', { name: 'team' }, { users: toMany('user', [bob.userId]) })
    const chat = await createAs(alice, 'chat', { name: 'Team chat', visibility: 'shared' })
    await createAs(
      alice, 'chat_share', grant
      , { chat: toOne('chat', chat), user_group: toOne('user_group', group) })
    return { app, alice, bob, carol, group, chat }
  }

describe('inherited access', () => {
  test('members read every message in a chat without per-message shares', async () => {
    const { alice, bob, carol, chat } = await setup()

    expect((await post(alice, chat, 'from alice')).status).toBe(201)
    expect((await post(bob, chat, 'from bob')).status).toBe(201)

    expect(await texts(alice)).toEqual(['from alice', 'from bob'])
    expect(await texts(bob)).toEqual(['from alice', 'from bob'])
    expect(await texts(carol)).toEqual([])
  })

  test('only people who can write to the chat can post into it', async () => {
    const { bob, carol, chat } = await setup({ can_read: true, can_write: false })

    expect((await post(carol, chat, 'intruder')).status).toBe(404)
    expect((await post(bob, chat, 'read-only member')).status).toBe(404)
  })

  test('read-only members still read messages', async () => {
    const { alice, bob, chat } = await setup({ can_read: true, can_write: false })
    await post(alice, chat, 'announcement')

    expect(await texts(bob)).toEqual(['announcement'])
  })

  test('reading a message does not allow changing it', async () => {
    const { alice, bob, chat } = await setup()
    const id = (await json(await post(alice, chat, 'original'))).data.id

    const patch =
      await bob.request(
        'PATCH', `/message/${id}`
        , { data: { type: 'message', id, attributes: { text: 'edited by bob' } } })
    expect(patch.status).toBe(404)
    expect((await bob.request('DELETE', `/message/${id}`)).status).toBe(404)
    expect(await texts(alice)).toEqual(['original'])
  })

  test('leaving the group removes access to the chat\'s messages', async () => {
    const { alice, bob, group, chat } = await setup()
    await post(alice, chat, 'before')

    expect(await texts(bob)).toEqual(['before'])
    await alice.request(
      'PATCH', `/user_group/${group}/relationships/users`, toMany('user', []))
    expect(await texts(bob)).toEqual([])
  })

  test('the chat\'s related messages and includes follow the same rule', async () => {
    const { alice, bob, carol, chat } = await setup()
    await post(alice, chat, 'one')
    await post(bob, chat, 'two')

    expect(await texts(bob, `/chat/${chat}/messages`)).toEqual(['one', 'two'])
    const included = await json(await bob.request('GET', `/chat/${chat}?include=messages`))
    expect(included.included.map((x: any) => x.attributes.text).sort()).toEqual(['one', 'two'])
    expect(await texts(carol, `/chat/${chat}/messages`)).toBe(404)
  })

  test('a message cannot be moved into a chat the writer cannot write to', async () => {
    const { alice, carol, chat } = await setup()
    const own = await createAs(carol, 'chat', { name: 'Carol only' })
    const id = (await json(await post(carol, own, 'mine'))).data.id

    const move =
      await carol.request(
        'PATCH', `/message/${id}/relationships/chat`, toOne('chat', chat))
    expect(move.status).toBe(404)
    expect(await texts(alice)).toEqual([])
  })
})

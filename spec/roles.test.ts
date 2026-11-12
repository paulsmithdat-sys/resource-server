import { describe, expect, test } from 'bun:test'
import { resourceDocument, signIn, toOne, type SignedIn } from './helpers/session.ts'
import { createTestServer, JSON_API } from './helpers/test-server.ts'

const json =
  async (response: Response) => await response.json() as any

/** A server where alice is a configured admin, with one anonymous feedback row. */
const setup =
  async () => {
    const { app, db } = await createTestServer({ session: true, admins: ['Alice'] })
    const alice = await signIn(app, 'alice')
    const bob = await signIn(app, 'bob')
    const created =
      await app.request('/feedback'
        , { method: 'POST'
          , headers: { 'content-type': JSON_API }
          , body: JSON.stringify(resourceDocument('feedback', { message: 'Anonymous note' }))
          })
    return { app, db, alice, bob, feedback: (await json(created)).data.id as string }
  }

/** Give a user a role, as another user. */
const grant =
  (admin: SignedIn, user: SignedIn, role: string) => {
    return admin.request(
      'POST', '/user_role'
      , resourceDocument('user_role', { role }, { user: toOne('user', user.userId) }))
  }

describe('roles', () => {
  test('an admin can read, update and delete rows that have no owner', async () => {
    const { alice, bob, feedback } = await setup()

    expect((await bob.request('GET', `/feedback/${feedback}`)).status).toBe(404)
    expect((await json(await bob.request('GET', '/feedback'))).data).toEqual([])

    expect((await alice.request('GET', `/feedback/${feedback}`)).status).toBe(200)
    expect((await json(await alice.request('GET', '/feedback'))).data.length).toBe(1)
    const patch =
      await alice.request(
        'PATCH', `/feedback/${feedback}`
        , { data: { type: 'feedback', id: feedback, attributes: { message: 'Reviewed' } } })
    expect(patch.status).toBe(200)
    expect((await bob.request('DELETE', `/feedback/${feedback}`)).status).toBe(404)
    expect((await alice.request('DELETE', `/feedback/${feedback}`)).status).toBe(204)
  })

  test('a role only grants the operations the schema lists for it', async () => {
    const { alice } = await setup()

    // audit_log gives admins read only, and nobody may create rows through the API.
    const create =
      await alice.request(
        'POST', '/audit_log', resourceDocument('audit_log', { action: 'forged', resource: 'x' }))
    expect(create.status).toBe(403)
  })

  test('only admins can grant roles, and a grant takes effect at once', async () => {
    const { alice, bob, feedback } = await setup()

    expect((await grant(bob, bob, 'admin')).status).toBe(403)
    expect((await bob.request('GET', `/feedback/${feedback}`)).status).toBe(404)

    const granted = await grant(alice, bob, 'admin')
    expect(granted.status).toBe(201)
    expect((await bob.request('GET', `/feedback/${feedback}`)).status).toBe(200)

    const id = (await json(granted)).data.id
    expect((await alice.request('DELETE', `/user_role/${id}`)).status).toBe(204)
    expect((await bob.request('GET', `/feedback/${feedback}`)).status).toBe(404)
  })

  test('other roles do not unlock admin-only resources, and role rows stay private', async () => {
    const { app, alice, bob, feedback } = await setup()
    const carol = await signIn(app, 'carol')

    expect((await grant(alice, bob, 'moderator')).status).toBe(201)
    expect((await bob.request('GET', `/feedback/${feedback}`)).status).toBe(404)
    expect((await json(await bob.request('GET', '/user_role'))).data).toEqual([])
    expect((await json(await carol.request('GET', '/user_role'))).data).toEqual([])
    expect((await json(await alice.request('GET', '/user_role'))).data.length).toBe(1)
  })

  test('a group named admin gives no role', async () => {
    const { bob, feedback } = await setup()

    const group =
      await bob.request(
        'POST', '/user_group'
        , resourceDocument('user_group', { name: 'admin' }, { users: { data: [{ type: 'user', id: bob.userId }] } }))
    expect(group.status).toBe(201)
    expect((await bob.request('GET', `/feedback/${feedback}`)).status).toBe(404)
  })

  test('without configured admins nobody holds the admin role', async () => {
    const { app } = await createTestServer({ session: true })
    const alice = await signIn(app, 'alice')

    expect((await grant(alice, alice, 'admin')).status).toBe(403)
  })
})

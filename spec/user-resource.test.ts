import { describe, expect, test } from 'bun:test'
import { resourceDocument, signIn } from './helpers/session.ts'
import { createTestServer } from './helpers/test-server.ts'

const json = async (response: Response) => await response.json() as any

/** A session-enforcing server where alice is a configured admin and bob is an ordinary user. */
const setup =
  async () => {
    const { app } = await createTestServer({ session: true, admins: ['alice'] })
    return { app, alice: await signIn(app, 'alice'), bob: await signIn(app, 'bob') }
  }

const patch =
  (user: Awaited<ReturnType<typeof signIn>>, attributes: Record<string, unknown>) =>
    user.request(
      'PATCH', `/user/${user.userId}`
      , { data: { type: 'user', id: user.userId, attributes } })

describe('the user resource', () => {
  test('users are created by registration, never through the API', async () => {
    const { bob } = await setup()
    const response = await bob.request('POST', '/user', resourceDocument('user', { username: 'squatter' }))
    expect(response.status).toBe(403)
  })

  test('a username cannot be changed, so nobody can take an admin name by renaming', async () => {
    const { bob } = await setup()
    const rename = await patch(bob, { username: 'Alice' })
    expect(rename.status).toBe(400)
    expect(JSON.stringify(await json(rename))).toContain('username')

    const own = await json(await bob.request('GET', `/user/${bob.userId}`))
    expect(own.data.attributes.username).toBe('bob')
  })

  test('display name can be changed', async () => {
    const { bob } = await setup()
    expect((await patch(bob, { display_name: 'Bob B' })).status).toBe(200)
  })

  test('email is optional and only has to look like an email address', async () => {
    const { bob } = await setup()
    expect((await patch(bob, { email: 'not-an-email' })).status).toBe(400)
    expect((await patch(bob, { email: 'bob@example.com' })).status).toBe(200)
    const own = await json(await bob.request('GET', `/user/${bob.userId}`))
    expect(own.data.attributes.email).toBe('bob@example.com')
  })

  test('two users may give the same email: it is never verified or unique', async () => {
    const { alice, bob } = await setup()
    expect((await patch(alice, { email: 'shared@example.com' })).status).toBe(200)
    expect((await patch(bob, { email: 'shared@example.com' })).status).toBe(200)
  })

  test('a user can delete their own account, which ends their session', async () => {
    const { bob } = await setup()
    expect((await bob.request('DELETE', `/user/${bob.userId}`)).status).toBe(204)
    expect((await bob.request('GET', `/user/${bob.userId}`)).status).toBe(401)
  })

  test("deleting an account leaves other users' accounts alone", async () => {
    const { alice, bob } = await setup()
    await bob.request('DELETE', `/user/${bob.userId}`)
    expect((await alice.request('GET', `/user/${alice.userId}`)).status).toBe(200)
  })
})

describe('the catalog', () => {
  test('needs a session when the server enforces sessions', async () => {
    const { app, bob } = await setup()
    expect((await app.request('/')).status).toBe(401)
    expect((await bob.request('GET', '/')).status).toBe(200)
  })
})

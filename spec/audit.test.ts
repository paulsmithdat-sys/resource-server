import { describe, expect, test } from 'bun:test'
import { createApp } from '../src/server/app.ts'
import { sendFinishLogin, startLogin } from './helpers/auth-client.ts'
import
  { PASSWORD
  , resourceDocument
  , signIn
  , signedRequestAs
  , type SignedIn
  } from './helpers/session.ts'
import { createTestServer, opaqueServerSetup } from './helpers/test-server.ts'

const json =
  async (response: Response) => await response.json() as any

const entries =
  async (admin: SignedIn, filter = '') => {
    // Purpose: read audit_log entries as an admin
    const response = await admin.request('GET', `/audit_log?page[size]=100${filter}`)
    return ((await json(response)).data as any[]).map(x => x.attributes)
  }

const payment = resourceDocument('payment', { amount: 100, currency: 'NZD' })

describe('audit trail', () => {
  test('records who did what to an audited resource, with the signature', async () => {
    const { app } = await createTestServer({ session: true, admins: ['alice'] })
    const alice = await signIn(app, 'alice')
    const bob = await signIn(app, 'bob')

    const created = await signedRequestAs(app, bob, 'POST', '/payment', payment)
    expect(created.status).toBe(201)
    const id = (await json(created)).data.id
    expect((await signedRequestAs(app, bob, 'DELETE', `/payment/${id}`)).status).toBe(204)

    const log = await entries(alice, '&filter[resource]=payment&sort=updated_at')
    expect(log.map(x => x.action)).toEqual(['create', 'delete'])
    for (const entry of log) {
      expect(entry.actor).toBe(bob.userId)
      expect(entry.resource_id).toBe(id)
      expect(entry.signature.length).toBeGreaterThan(40)
    }
  })

  test('rejected writes leave no entry', async () => {
    const { app } = await createTestServer({ session: true, admins: ['alice'] })
    const alice = await signIn(app, 'alice')
    const bob = await signIn(app, 'bob')

    expect((await bob.request('POST', '/payment', payment)).status).toBe(401)
    const invalid = resourceDocument('payment', { amount: 'lots', currency: 'NZD' })
    expect((await signedRequestAs(app, bob, 'POST', '/payment', invalid)).status).toBe(400)

    expect(await entries(alice, '&filter[resource]=payment')).toEqual([])
  })

  test('records successful and failed logins', async () => {
    const { app } = await createTestServer({ session: true, admins: ['alice'] })
    const alice = await signIn(app, 'alice')
    const start = await startLogin(app, { username: 'alice', password: PASSWORD })
    await sendFinishLogin(app, start.document.id, 'garbage')

    const log = await entries(alice, '&filter[resource]=session')
    expect(log.map(x => x.action).sort()).toEqual(['login', 'login_failed'])
    expect(log.every(x => x.actor === alice.userId)).toBe(true)
  })

  test('is readable only by admins and cannot be changed through the API', async () => {
    const { app } = await createTestServer({ session: true, admins: ['alice'] })
    const alice = await signIn(app, 'alice')
    const bob = await signIn(app, 'bob')

    expect((await json(await bob.request('GET', '/audit_log'))).data).toEqual([])
    const all = await json(await alice.request('GET', '/audit_log'))
    const id = all.data[0].id
    const patch =
      await alice.request(
        'PATCH', `/audit_log/${id}`
        , { data: { type: 'audit_log', id, attributes: { action: 'nothing' } } })
    expect(patch.status).toBe(404)
    expect((await alice.request('DELETE', `/audit_log/${id}`)).status).toBe(404)
  })
})

describe('login limits are stored in the database', () => {
  test('a lockout survives a server restart', async () => {
    const { app, db, built } = await createTestServer()
    await signIn(app, 'alice')
    for (let i = 0; i < 5; i++) {
      const start = await startLogin(app, { username: 'alice', password: PASSWORD })
      await sendFinishLogin(app, start.document.id, 'garbage')
    }

    const restarted = createApp({ built, db, opaqueServerSetup })
    const locked = await startLogin(restarted as any, { username: 'alice', password: PASSWORD })
    expect(locked.response.status).toBe(429)
  })
})

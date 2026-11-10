import { describe, expect, test } from 'bun:test'
import { generateKeyPair } from '../src/auth/keys.ts'
import
  { completeClientLogin
  , completeClientRegistration
  , credentials
  , finishLogin
  , finishRegistration
  , login
  , postKey
  , register
  , sendFinishLogin
  , sendFinishRegistration
  , startLogin
  , startRegistration
  } from './helpers/auth-client.ts'
import { createTestServer } from './helpers/test-server.ts'

const PASSWORD = credentials().password

const count =
  async (db: any, sql: string, params: unknown[] = []) => {
    // Purpose: run a COUNT(*) query and return the number
    const row = await db.get(sql, params)
    return Number(row?.n ?? 0)
  }

const userCount =
  (db: any, username: string) => {
    // Purpose: count user rows with the given username
    return count(db, 'SELECT COUNT(*) AS n FROM `user` WHERE `username` = ?', [username])
  }

const sessionCount =
  (db: any) => {
    // Purpose: count live session rows in the key table
    return count(db, "SELECT COUNT(*) AS n FROM `key` WHERE `type` = 'session'")
  }

describe('registration robustness', () => {
  test('rejects a malformed registration record at finish and creates no user', async () => {
    const { app, db } = await createTestServer()
    const start = await startRegistration(app, credentials())
    expect(start.response.status).toBe(201)

    const finish = await sendFinishRegistration(app, start.document.id, 'not-a-registration-record')

    expect(finish.response.status).toBe(400)
    expect(await userCount(db, 'alice')).toBe(0)
  })

  test('a rejected registration record leaves the pending state usable for a valid one', async () => {
    const { app } = await createTestServer()
    const start = await startRegistration(app, credentials())

    const bad = await sendFinishRegistration(app, start.document.id, 'not-a-registration-record')
    expect(bad.response.status).toBeLessThan(500)

    const good = await finishRegistration(app, start)
    expect(good.response.status).toBe(200)
    const session = await login(app, { username: 'alice', password: PASSWORD })
    expect(session.finish.response.status).toBe(200)
  })

  test('rejects a malformed registration request at start with 400, not 500', async () => {
    const { app } = await createTestServer()

    const response =
      await postKey(
        app
        , { type: 'opaque_registration'
          , username: 'alice'
          , email: 'alice@example.com'
          , registrationRequest: 'not-an-opaque-request'
          , clientPublicKey: generateKeyPair().publicJwk
          })

    expect(response.status).toBe(400)
  })

  test('rejects a malformed login request at start with 400, not 500', async () => {
    const { app } = await createTestServer()
    await register(app, credentials())

    const response =
      await postKey(
        app
        , { type: 'opaque_login_state'
          , username: 'alice'
          , startLoginRequest: 'not-an-opaque-request'
          , clientPublicKey: generateKeyPair().publicJwk
          })

    expect(response.status).toBe(400)
  })

  test('registering never issues a session; the user must log in', async () => {
    const { app, db } = await createTestServer()

    await register(app, credentials())

    expect(await sessionCount(db)).toBe(0)
  })

  test('concurrent registrations of the same username create exactly one user', async () => {
    const { app, db } = await createTestServer()
    const first = await startRegistration(app, credentials({ email: 'one@example.com' }))
    const second = await startRegistration(app, credentials({ email: 'two@example.com' }))
    expect(first.response.status).toBe(201)
    expect(second.response.status).toBe(201)

    const results = await Promise.all([finishRegistration(app, first), finishRegistration(app, second)])
    const statuses = results.map(x => x.response.status).sort()

    expect(statuses).toEqual([200, 409])
    expect(await userCount(db, 'alice')).toBe(1)
  })

  test('concurrent registrations of the same email create exactly one user', async () => {
    const { app, db } = await createTestServer()
    const first = await startRegistration(app, credentials({ username: 'alice' }))
    const second = await startRegistration(app, credentials({ username: 'alicia' }))

    const results = await Promise.all([finishRegistration(app, first), finishRegistration(app, second)])

    expect(results.map(x => x.response.status).sort()).toEqual([200, 409])
    expect(await count(db, 'SELECT COUNT(*) AS n FROM `user` WHERE `email` = ?', ['alice@example.com'])).toBe(1)
    expect(await userCount(db, 'alice') + await userCount(db, 'alicia')).toBe(1)
  })

  test('the same pending registration cannot be finished twice concurrently', async () => {
    const { app, db } = await createTestServer()
    const start = await startRegistration(app, credentials())
    const record = completeClientRegistration(start)

    const results =
      await Promise.all(
        [ sendFinishRegistration(app, start.document.id, record)
        , sendFinishRegistration(app, start.document.id, record)
        ])

    expect(results.map(x => x.response.status).sort()).toEqual([200, 401])
    expect(await userCount(db, 'alice')).toBe(1)
  })

  test('two users with different passwords cannot log in with each other\'s', async () => {
    const { app } = await createTestServer()
    await register(app, credentials({ username: 'alice', email: 'a@example.com', password: 'alice password one' }))
    await register(app, credentials({ username: 'bob', email: 'b@example.com', password: 'bob password two' }))

    for (const attempt of
      [ { username: 'alice', password: 'bob password two' }
      , { username: 'bob', password: 'alice password one' }
      ]) {
      const start = await startLogin(app, attempt)
      const finish = await finishLogin(app, start)
      expect(finish === undefined || finish.response.status === 401).toBe(true)
    }
  })

  test('treats usernames and emails case-insensitively', async () => {
    const { app, db } = await createTestServer()
    await register(app, credentials())

    const sameName =
      await startRegistration(app, credentials({ username: 'ALICE', email: 'other@example.com' }))
    const sameEmail =
      await startRegistration(app, credentials({ username: 'alicia', email: 'Alice@Example.com' }))
    expect(sameName.response.status).toBe(409)
    expect(sameEmail.response.status).toBe(409)

    const session = await login(app, { username: 'ALICE', password: PASSWORD })
    expect(session.finish.response.status).toBe(200)

    await register(app, credentials({ username: 'Bob', email: 'Bob@Example.com' }))
    expect(await userCount(db, 'bob')).toBe(1)
  })
})

describe('login robustness', () => {
  test('a user with only a pending registration cannot log in', async () => {
    const { app, db } = await createTestServer()
    await startRegistration(app, credentials({ username: 'carol', email: 'carol@example.com' }))

    const start = await startLogin(app, { username: 'carol', password: PASSWORD })
    expect(start.response.status).toBe(201)
    const finish = await finishLogin(app, start)

    expect(finish === undefined || finish.response.status === 401).toBe(true)
    expect(await sessionCount(db)).toBe(0)
  })

  test('a finish request from another login attempt cannot complete this one', async () => {
    const { app, db } = await createTestServer()
    await register(app, credentials())

    const first = await startLogin(app, { username: 'alice', password: PASSWORD })
    const second = await startLogin(app, { username: 'alice', password: PASSWORD })
    const forSecond = completeClientLogin(second)!

    const response = await sendFinishLogin(app, first.document.id, forSecond.finishLoginRequest)

    expect(response.response.status).toBe(401)
    expect(await sessionCount(db)).toBe(0)
  })

  test('one user\'s valid finish request cannot complete another user\'s login', async () => {
    const { app, db } = await createTestServer()
    await register(app, credentials({ username: 'alice', email: 'a@example.com' }))
    await register(app, credentials({ username: 'bob', email: 'b@example.com' }))

    const aliceStart = await startLogin(app, { username: 'alice', password: PASSWORD })
    const bobStart = await startLogin(app, { username: 'bob', password: PASSWORD })
    const bobFinish = completeClientLogin(bobStart)!

    const response = await sendFinishLogin(app, aliceStart.document.id, bobFinish.finishLoginRequest)

    expect(response.response.status).toBe(401)
    expect(await sessionCount(db)).toBe(0)
  })

  test('the same login state cannot produce two sessions concurrently', async () => {
    const { app, db } = await createTestServer()
    await register(app, credentials())
    const start = await startLogin(app, { username: 'alice', password: PASSWORD })
    const result = completeClientLogin(start)!

    const responses =
      await Promise.all(
        [ sendFinishLogin(app, start.document.id, result.finishLoginRequest)
        , sendFinishLogin(app, start.document.id, result.finishLoginRequest)
        ])

    expect(responses.map(x => x.response.status).sort()).toEqual([200, 401])
    expect(await sessionCount(db)).toBe(1)
  })

  test('garbage finish requests are 401 and never create a session', async () => {
    const { app, db } = await createTestServer()
    await register(app, credentials())

    for (const garbage of ['x', 'AAAA', 'not base64 !!', 'A'.repeat(4096)]) {
      const start = await startLogin(app, { username: 'alice', password: PASSWORD })
      const response = await sendFinishLogin(app, start.document.id, garbage)
      expect({ garbage: garbage.slice(0, 8), status: response.response.status })
        .toEqual({ garbage: garbage.slice(0, 8), status: 401 })
    }
    expect(await sessionCount(db)).toBe(0)
  })

  test('failed and successful logins give the same start shape for known and unknown users', async () => {
    const { app } = await createTestServer()
    await register(app, credentials())

    const known = await startLogin(app, { username: 'alice', password: 'wrong password' })
    const unknown = await startLogin(app, { username: 'nobody', password: 'wrong password' })

    expect(known.response.status).toBe(unknown.response.status)
    expect(Object.keys(known.document).sort()).toEqual(Object.keys(unknown.document).sort())
    expect(known.document.loginResponse.length).toBe(unknown.document.loginResponse.length)
  })

  test('a deleted login state cannot be finished', async () => {
    const { app } = await createTestServer()
    await register(app, credentials())
    const start = await startLogin(app, { username: 'alice', password: PASSWORD })
    const result = completeClientLogin(start)!

    expect((await app.request(`/key/${start.document.id}`, { method: 'DELETE' })).status).toBe(204)

    const response = await sendFinishLogin(app, start.document.id, result.finishLoginRequest)
    expect(response.response.status).toBe(401)
  })

  test('a failed finish burns the login state, so one state allows one guess', async () => {
    const { app, db } = await createTestServer()
    await register(app, credentials())
    const start = await startLogin(app, { username: 'alice', password: PASSWORD })
    const result = completeClientLogin(start)!

    expect((await sendFinishLogin(app, start.document.id, 'garbage')).response.status).toBe(401)
    expect((await sendFinishLogin(app, start.document.id, result.finishLoginRequest)).response.status).toBe(401)
    expect(await sessionCount(db)).toBe(0)
  })

  test('rate limits login starts per username', async () => {
    const { app } = await createTestServer()
    await register(app, credentials())

    const statuses: number[] = []
    for (let i = 0; i < 31; i++)
      statuses.push((await startLogin(app, { username: 'alice', password: PASSWORD })).response.status)

    expect(statuses.slice(0, 30).every(x => x === 201)).toBe(true)
    expect(statuses[30]).toBe(429)
  })

  test('rate limits login starts per client across usernames', async () => {
    const { app } = await createTestServer()

    const statuses: number[] = []
    for (let i = 0; i < 31; i++)
      statuses.push((await startLogin(app, { username: `user${i}`, password: PASSWORD })).response.status)

    expect(statuses[30]).toBe(429)
  })

  test('locks a username after repeated failed logins until the lock expires', async () => {
    const { app } = await createTestServer()
    await register(app, credentials())

    for (let i = 0; i < 5; i++) {
      const start = await startLogin(app, { username: 'alice', password: 'wrong password' })
      expect((await sendFinishLogin(app, start.document.id, 'garbage')).response.status).toBe(401)
    }

    const locked = await startLogin(app, { username: 'alice', password: PASSWORD })
    expect(locked.response.status).toBe(429)

    const originalNow = Date.now
    Date.now = () => originalNow() + 16 * 60_000
    try {
      const session = await login(app, { username: 'alice', password: PASSWORD })
      expect(session.finish.response.status).toBe(200)
    } finally {
      Date.now = originalNow
    }
  })

  test('lockout is the same for unknown usernames, so it does not reveal who exists', async () => {
    const { app } = await createTestServer()

    for (let i = 0; i < 5; i++) {
      const start = await startLogin(app, { username: 'nobody', password: 'wrong password' })
      expect((await sendFinishLogin(app, start.document.id, 'garbage')).response.status).toBe(401)
    }

    expect((await startLogin(app, { username: 'nobody', password: PASSWORD })).response.status).toBe(429)
  })

  test('a successful login clears earlier failures', async () => {
    const { app } = await createTestServer()
    await register(app, credentials())

    for (let round = 0; round < 3; round++) {
      for (let i = 0; i < 4; i++) {
        const start = await startLogin(app, { username: 'alice', password: 'wrong password' })
        await sendFinishLogin(app, start.document.id, 'garbage')
      }
      const session = await login(app, { username: 'alice', password: PASSWORD })
      expect(session.finish.response.status).toBe(200)
    }
  })
})

describe('key type dispatch', () => {
  test('rejects prototype property names as the key type', async () => {
    const { app } = await createTestServer()

    for (const type of ['constructor', 'toString', '__proto__', 'hasOwnProperty']) {
      const response = await postKey(app, { type })
      expect({ type, status: response.status }).toEqual({ type, status: 400 })
    }
  })
})

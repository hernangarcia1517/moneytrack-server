import './testGuard.js'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { after, describe, it } from 'node:test'
import { eq } from 'drizzle-orm'
import { buildApp } from './app.js'
import { hashToken, userIdForToken } from './auth/sessions.js'
import { testAuthEnabled, testUserSession } from './auth/testSession.js'
import { closeDb, db } from './db/client.js'
import { sessions, users } from './db/schema.js'

const testDb = 'postgres://u:p@127.0.0.1:5432/moneytrack_test'
const otherDb = 'postgres://u:p@127.0.0.1:5432/moneytrack_db'
const createdHashes: string[] = []

after(async () => {
  for (const hash of createdHashes) await db.delete(sessions).where(eq(sessions.tokenHash, hash))
  await closeDb()
})

describe('test-only sign-in switch', () => {
  it('is off unless the flag is "true"', () => {
    assert.equal(testAuthEnabled({ DATABASE_URL: testDb }), false)
    assert.equal(testAuthEnabled({ ENABLE_TEST_AUTH: 'false', DATABASE_URL: otherDb }), false)
  })

  it('is on for the test database', () => {
    assert.equal(testAuthEnabled({ ENABLE_TEST_AUTH: 'true', DATABASE_URL: testDb }), true)
  })

  it('refuses to start on any other database, or when the database is unknown', () => {
    assert.throws(() => testAuthEnabled({ ENABLE_TEST_AUTH: 'true', DATABASE_URL: otherDb }), /Refusing to start/)
    assert.throws(() => testAuthEnabled({ ENABLE_TEST_AUTH: 'true' }), /Refusing to start/)
  })

  it('reads an encoded database name the way the driver does', () => {
    const url = 'postgres://u:p@127.0.0.1:5432/moneytrack%5Ftest'
    assert.equal(testAuthEnabled({ ENABLE_TEST_AUTH: 'true', DATABASE_URL: url }), true)
  })

  const unreadable = {
    'a bad port': 'postgres://u:secretpw@localhost:notaport/moneytrack_test',
    'a # in the password': 'postgres://u:secret#pw@localhost/moneytrack_test',
    'a missing //': 'postgres:u:secretpw@localhost/moneytrack_test',
  }
  for (const [label, url] of Object.entries(unreadable)) {
    it(`refuses ${label} without printing the password`, () => {
      assert.throws(
        () => testAuthEnabled({ ENABLE_TEST_AUTH: 'true', DATABASE_URL: url }),
        (error: Error) => /Refusing to start/.test(error.message) && !`${error.stack}${JSON.stringify(error)}`.includes('secret'),
      )
    })
  }
})

function withEnv<T>(vars: Record<string, string | undefined>, run: () => T): T {
  const saved = Object.fromEntries(Object.keys(vars).map((key) => [key, process.env[key]]))
  const apply = (values: Record<string, string | undefined>) => {
    for (const [key, value] of Object.entries(values)) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
  }
  apply(vars)
  try {
    return run()
  } finally {
    apply(saved)
  }
}

describe('POST /auth/test-session', () => {
  it('returns a session for the seeded test user when the flag is on', async () => {
    const app = withEnv({ ENABLE_TEST_AUTH: 'true' }, () => buildApp())
    const res = await app.inject({ method: 'POST', url: '/auth/test-session' })
    assert.equal(res.statusCode, 200)
    const token = res.json().sessionToken as string
    createdHashes.push(createHash('sha256').update(token).digest('hex'))
    const [testUser] = await db.select({ id: users.id }).from(users).where(eq(users.name, 'hernan')).limit(1)
    assert.equal(await userIdForToken(token), testUser?.id)
    await app.close()
  })

  it('does not exist when the flag is off', async () => {
    const app = withEnv({ ENABLE_TEST_AUTH: undefined }, () => buildApp())
    const token = await testUserSession()
    createdHashes.push(hashToken(token))
    const res = await app.inject({ method: 'POST', url: '/auth/test-session', headers: { authorization: `Bearer ${token}` } })
    assert.equal(res.statusCode, 404)
    await app.close()
  })

  it('stops the app from being built when the flag is on and the database is not the test one', () => {
    assert.throws(() => withEnv({ ENABLE_TEST_AUTH: 'true', DATABASE_URL: otherDb }, () => buildApp()), /Refusing to start/)
  })
})

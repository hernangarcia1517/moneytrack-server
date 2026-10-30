import './testGuard.js'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { after, before, describe, it } from 'node:test'
import { eq, inArray } from 'drizzle-orm'
import { buildApp } from './app.js'
import { hashToken } from './auth/sessions.js'
import { testUserSession } from './auth/testSession.js'
import { closeDb, db } from './db/client.js'
import { sessions, users } from './db/schema.js'
import { signedInClient } from './testClient.js'

process.env.ENABLE_TEST_AUTH = 'true'
const app = buildApp({ verifyApple: async (identityToken) => ({ sub: identityToken }) })
const api = signedInClient(app)
const createdBudgets: string[] = []
const createdSubs: string[] = []
const createdTokens: string[] = []

const bearer = (token: string) => ({ authorization: `Bearer ${token}` })
const someId = randomUUID()

function newSub() {
  const sub = `authz-test-${randomUUID()}`
  createdSubs.push(sub)
  return sub
}

async function signInAsNewUser() {
  const res = await app.inject({ method: 'POST', url: '/auth/apple', payload: { identityToken: newSub(), nonce: 'n' } })
  assert.equal(res.statusCode, 200)
  return res.json().sessionToken as string
}

before(async () => {
  await app.ready()
  await api.start()
})

after(async () => {
  for (const id of createdBudgets) await api.inject({ method: 'DELETE', url: `/budgets/${id}` })
  await api.stop()
  for (const token of createdTokens) await db.delete(sessions).where(eq(sessions.tokenHash, hashToken(token)))
  if (createdSubs.length > 0) await db.delete(users).where(inArray(users.authProviderId, createdSubs))
  await app.close()
  await closeDb()
})

describe('every route but the sign-in ones needs a session token', () => {
  const protectedRoutes: Array<[string, string]> = [
    ['GET', '/budgets?month=2026-10'],
    ['POST', '/budgets'],
    ['PATCH', `/budgets/${someId}`],
    ['DELETE', `/budgets/${someId}`],
    ['PUT', `/budgets/${someId}/cap/2026-10`],
    ['GET', '/transactions?month=2026-10'],
    ['POST', '/transactions'],
    ['PATCH', `/transactions/${someId}`],
    ['DELETE', `/transactions/${someId}`],
    ['POST', '/auth/signout'],
  ]
  for (const [method, url] of protectedRoutes) {
    it(`${method} ${url.split('?')[0]?.replace(someId, ':id')} answers 401 without a token`, async () => {
      const res = await app.inject({ method: method as 'GET', url })
      assert.equal(res.statusCode, 401)
      assert.deepEqual(res.json(), { error: 'Unauthorized' })
    })
  }

  it('answers 401 for an unknown token, a wrong scheme and an empty token', async () => {
    for (const authorization of ['Bearer not-a-real-token', 'Basic abc', 'Bearer ']) {
      const res = await app.inject({ method: 'GET', url: '/budgets?month=2026-10', headers: { authorization } })
      assert.equal(res.statusCode, 401, authorization)
    }
  })

  it('answers 401 for a path that does not exist, so nothing is revealed without a token', async () => {
    assert.equal((await app.inject({ method: 'GET', url: '/nope' })).statusCode, 401)
  })

  it('lets the two sign-in routes through without a token', async () => {
    createdTokens.push(await signInAsNewUser())
    const test = await app.inject({ method: 'POST', url: '/auth/test-session' })
    assert.equal(test.statusCode, 200)
    createdTokens.push(test.json().sessionToken)
  })
})

describe('POST /auth/signout', () => {
  it('ends only the session it was called with', async () => {
    const phone = await testUserSession()
    const ipad = await testUserSession()
    createdTokens.push(phone, ipad)
    assert.equal((await app.inject({ method: 'POST', url: '/auth/signout', headers: bearer(phone) })).statusCode, 204)
    assert.equal((await app.inject({ method: 'GET', url: '/budgets?month=2026-10', headers: bearer(phone) })).statusCode, 401)
    assert.equal((await app.inject({ method: 'POST', url: '/auth/signout', headers: bearer(phone) })).statusCode, 401)
    assert.equal((await app.inject({ method: 'GET', url: '/budgets?month=2026-10', headers: bearer(ipad) })).statusCode, 200)
  })
})

describe('users only see their own data', () => {
  it("a second user cannot list, change or delete the first user's budget", async () => {
    const created = await api.inject({
      method: 'POST',
      url: '/budgets',
      payload: { name: `Authz ${randomUUID().slice(0, 8)}`, budgetGroup: 'Needs', cap: '10.00', month: '2026-10' },
    })
    assert.equal(created.statusCode, 201)
    const budgetId = created.json().id as string
    createdBudgets.push(budgetId)

    const other = await signInAsNewUser()
    createdTokens.push(other)
    const list = await app.inject({ method: 'GET', url: '/budgets?month=2026-10', headers: bearer(other) })
    assert.equal(list.statusCode, 200)
    assert.deepEqual(list.json(), [])
    const patch = await app.inject({ method: 'PATCH', url: `/budgets/${budgetId}`, headers: bearer(other), payload: { name: 'Mine now' } })
    assert.equal(patch.statusCode, 404)
    assert.equal((await app.inject({ method: 'DELETE', url: `/budgets/${budgetId}`, headers: bearer(other) })).statusCode, 404)
  })
})

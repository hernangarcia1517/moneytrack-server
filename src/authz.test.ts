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
const routes: Array<{ method: string; url: string; public: boolean }> = []
app.addHook('onRoute', (route) => {
  for (const method of [route.method].flat()) routes.push({ method, url: route.url, public: Boolean(route.config?.public) })
})
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
  it('answers 401 without a token on every registered route that is not marked public', async () => {
    const protectedRoutes = routes.filter((route) => !route.public)
    assert.ok(protectedRoutes.length >= 10, `only found ${protectedRoutes.length} protected routes`)
    for (const { method, url } of protectedRoutes) {
      const res = await app.inject({ method: method as 'GET', url: url.replace(':id', someId).replace(':month', '2026-10') })
      assert.equal(res.statusCode, 401, `${method} ${url}`)
      assert.equal(res.headers['www-authenticate'], 'Bearer', `${method} ${url}`)
      if (method !== 'HEAD') assert.deepEqual(res.json(), { error: 'Unauthorized' }, `${method} ${url}`)
    }
  })

  it('has exactly two routes open to everyone', () => {
    const open = routes.filter((route) => route.public).map((route) => `${route.method} ${route.url}`)
    assert.deepEqual(open.sort(), ['POST /auth/apple', 'POST /auth/test-session'])
  })

  it('answers 401 for an unknown token, a wrong scheme and an empty token', async () => {
    for (const authorization of ['Bearer not-a-real-token', 'Basic abc', 'Bearer ']) {
      const res = await app.inject({ method: 'GET', url: '/budgets?month=2026-10', headers: { authorization } })
      assert.equal(res.statusCode, 401, authorization)
    }
  })

  it('accepts the scheme in any case and with extra spaces, but the token stays case-sensitive', async () => {
    const token = await testUserSession()
    createdTokens.push(token)
    const send = (authorization: string) =>
      app.inject({ method: 'GET', url: '/budgets?month=2026-10', headers: { authorization } })
    for (const scheme of ['Bearer ', 'bearer ', 'BEARER ', 'Bearer   ']) {
      assert.equal((await send(`${scheme}${token}`)).statusCode, 200, scheme)
    }
    const swapped = [...token].map((c) => (c === c.toLowerCase() ? c.toUpperCase() : c.toLowerCase())).join('')
    assert.notEqual(swapped, token)
    assert.equal((await send(`Bearer ${swapped}`)).statusCode, 401)
  })

  it('rejects a valid token in any shape other than "Bearer", spaces, token', async () => {
    const token = await testUserSession()
    createdTokens.push(token)
    for (const authorization of [`Bearer ${token} extra`, `Bearer\t${token}`, `Bearer${token}`, ` Bearer ${token}`, token]) {
      const res = await app.inject({ method: 'GET', url: '/budgets?month=2026-10', headers: { authorization } })
      assert.equal(res.statusCode, 401, JSON.stringify(authorization.replace(token, '<token>')))
    }
  })

  it('answers 401 for a path that does not exist and for OPTIONS, so nothing is revealed without a token', async () => {
    assert.equal((await app.inject({ method: 'GET', url: '/nope' })).statusCode, 401)
    assert.equal((await app.inject({ method: 'OPTIONS', url: '/budgets' })).statusCode, 401)
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

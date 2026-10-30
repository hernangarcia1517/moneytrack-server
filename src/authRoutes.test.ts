import './testGuard.js'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { after, before, describe, it } from 'node:test'
import { eq, inArray } from 'drizzle-orm'
import { AppleTokenError, type VerifyApple } from './auth/apple.js'
import { userIdForToken } from './auth/sessions.js'
import { buildApp } from './app.js'
import { closeDb, db } from './db/client.js'
import { users } from './db/schema.js'

const verifyApple: VerifyApple = async (identityToken) => {
  if (identityToken === 'bad') throw new AppleTokenError('bad token')
  return { sub: identityToken, email: `${identityToken}@example.com` }
}
const app = buildApp({ verifyApple })
const createdSubs: string[] = []
const newSub = () => {
  const sub = `apple-test-${randomUUID()}`
  createdSubs.push(sub)
  return sub
}
const signIn = (payload: Record<string, unknown>) => app.inject({ method: 'POST', url: '/auth/apple', payload })
const usersWithSub = (sub: string) => db.select().from(users).where(eq(users.authProviderId, sub))

before(async () => {
  await app.ready()
})

after(async () => {
  await db.delete(users).where(inArray(users.authProviderId, createdSubs))
  await app.close()
  await closeDb()
})

describe('POST /auth/apple', () => {
  it('creates the user on first sign-in and returns a session for it', async () => {
    const sub = newSub()
    const res = await signIn({ identityToken: sub, nonce: 'n', fullName: '  Ada Lovelace ' })
    assert.equal(res.statusCode, 200)
    const [user] = await usersWithSub(sub)
    assert.equal(user?.name, 'Ada Lovelace')
    assert.equal(user?.email, `${sub}@example.com`)
    assert.equal(await userIdForToken(res.json().sessionToken), user?.id)
  })

  it('uses "User" when no name is sent', async () => {
    const sub = newSub()
    assert.equal((await signIn({ identityToken: sub, nonce: 'n' })).statusCode, 200)
    assert.equal((await usersWithSub(sub))[0]?.name, 'User')
  })

  it('signing in again finds the same user, keeps the first name, and issues a new session', async () => {
    const sub = newSub()
    const first = await signIn({ identityToken: sub, nonce: 'n', fullName: 'Ada' })
    const second = await signIn({ identityToken: sub, nonce: 'n', fullName: 'Someone Else' })
    assert.equal(second.statusCode, 200)
    const found = await usersWithSub(sub)
    assert.equal(found.length, 1)
    assert.equal(found[0]?.name, 'Ada')
    assert.notEqual(first.json().sessionToken, second.json().sessionToken)
  })

  it('rejects a bad token with 401 and creates no user', async () => {
    const res = await signIn({ identityToken: 'bad', nonce: 'n' })
    assert.equal(res.statusCode, 401)
    assert.equal((await usersWithSub('bad')).length, 0)
  })

  it('rejects a body without a nonce', async () => {
    assert.equal((await signIn({ identityToken: newSub() })).statusCode, 400)
  })

  it('rejects a name longer than 200 characters and creates no user', async () => {
    const sub = newSub()
    assert.equal((await signIn({ identityToken: sub, nonce: 'n', fullName: 'x'.repeat(201) })).statusCode, 400)
    assert.equal((await usersWithSub(sub)).length, 0)
  })
})

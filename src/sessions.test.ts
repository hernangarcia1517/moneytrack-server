import './testGuard.js'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { after, before, describe, it } from 'node:test'
import { eq, inArray } from 'drizzle-orm'
import { createSession, revokeSession, userIdForToken } from './auth/sessions.js'
import { closeDb, db } from './db/client.js'
import { sessions, users } from './db/schema.js'

let userId: string
const createdTokens: string[] = []

async function newSession() {
  const token = await createSession(userId)
  createdTokens.push(token)
  return token
}

const sha256 = (value: string) => createHash('sha256').update(value).digest('hex')

before(async () => {
  const [user] = await db.select({ id: users.id }).from(users).where(eq(users.name, 'hernan')).limit(1)
  assert.ok(user, 'Test user "hernan" not found. Run `npm run db:seed` against the test database.')
  userId = user.id
})

after(async () => {
  await db.delete(sessions).where(inArray(sessions.tokenHash, createdTokens.map(sha256)))
  await closeDb()
})

describe('sessions', () => {
  it('a created session resolves to its user and the plain token is not stored', async () => {
    const token = await newSession()
    assert.equal(await userIdForToken(token), userId)
    const [stored] = await db.select({ hash: sessions.tokenHash }).from(sessions).where(eq(sessions.tokenHash, sha256(token)))
    assert.ok(stored)
    assert.notEqual(stored.hash, token)
  })

  it('a revoked token stops working and other sessions of the same user keep working', async () => {
    const phone = await newSession()
    const ipad = await newSession()
    await revokeSession(phone)
    assert.equal(await userIdForToken(phone), null)
    assert.equal(await userIdForToken(ipad), userId)
  })

  it('an unknown token resolves to nothing', async () => {
    assert.equal(await userIdForToken('not-a-real-token'), null)
  })
})

import { eq } from 'drizzle-orm'
import { db } from '../db/client.js'
import { users } from '../db/schema.js'
import { isTestDbName } from '../testDbName.js'
import { createSession } from './sessions.js'

export function testAuthEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  if (env.ENABLE_TEST_AUTH !== 'true') return false
  if (!isTestDbName(env.DATABASE_URL)) {
    throw new Error('ENABLE_TEST_AUTH is on but the database is not "moneytrack_test". Refusing to start.')
  }
  return true
}

export async function testUserSession(): Promise<string> {
  const [user] = await db.select({ id: users.id }).from(users).where(eq(users.name, 'hernan')).limit(1)
  if (!user) throw new Error('Seeded test user not found. Run `npm run db:seed`.')
  return createSession(user.id)
}

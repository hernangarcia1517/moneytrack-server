import { eq } from 'drizzle-orm'
import type { FastifyRequest } from 'fastify'
import { db } from '../db/client.js'
import { users } from '../db/schema.js'

let cachedId: string | undefined

// The one place that decides who is asking. For now it is always the seeded "hernan"
// user. When login lands, only this function changes: verify the provider's token from
// the request and look up the user by auth_provider_id.
export async function getCurrentUserId(_req: FastifyRequest): Promise<string> {
  if (cachedId) return cachedId
  const [user] = await db.select({ id: users.id }).from(users).where(eq(users.name, 'hernan')).limit(1)
  if (!user) throw new Error('Test user "hernan" not found. Run `npm run db:seed`.')
  cachedId = user.id
  return cachedId
}

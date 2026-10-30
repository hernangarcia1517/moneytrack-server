import { and, eq, isNull } from 'drizzle-orm'
import { closeDb, db } from './client.js'
import { users } from './schema.js'

// The seeded test user: auth_provider_id stays null, which marks it as not a real Apple user.
const [existing] = await db
  .select({ id: users.id })
  .from(users)
  .where(and(eq(users.name, 'hernan'), isNull(users.authProviderId)))
  .limit(1)

if (existing) {
  console.log(`Test user "hernan" already exists (${existing.id})`)
} else {
  const [created] = await db.insert(users).values({ name: 'hernan' }).returning({ id: users.id })
  console.log(`Created test user "hernan" (${created!.id})`)
}

await closeDb()

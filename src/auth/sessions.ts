import { createHash, randomBytes } from 'node:crypto'
import { and, eq, isNull } from 'drizzle-orm'
import { db } from '../db/client.js'
import { sessions } from '../db/schema.js'

const hashToken = (token: string) => createHash('sha256').update(token).digest('hex')

export async function createSession(userId: string): Promise<string> {
  const token = randomBytes(32).toString('base64url')
  await db.insert(sessions).values({ userId, tokenHash: hashToken(token) })
  return token
}

export async function userIdForToken(token: string): Promise<string | null> {
  const [row] = await db
    .select({ userId: sessions.userId })
    .from(sessions)
    .where(and(eq(sessions.tokenHash, hashToken(token)), isNull(sessions.revokedAt)))
    .limit(1)
  return row?.userId ?? null
}

export async function revokeSession(token: string): Promise<void> {
  await db
    .update(sessions)
    .set({ revokedAt: new Date() })
    .where(and(eq(sessions.tokenHash, hashToken(token)), isNull(sessions.revokedAt)))
}

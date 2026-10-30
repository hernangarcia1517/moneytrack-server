import { eq } from 'drizzle-orm'
import type { FastifyInstance, InjectOptions } from 'fastify'
import { hashToken } from './auth/sessions.js'
import { testUserSession } from './auth/testSession.js'
import { db } from './db/client.js'
import { sessions } from './db/schema.js'

export function signedInClient(app: FastifyInstance) {
  let token = ''
  return {
    async start() {
      token = await testUserSession()
    },
    inject: (opts: InjectOptions) =>
      app.inject({ ...opts, headers: { ...opts.headers, authorization: `Bearer ${token}` } }),
    async stop() {
      await db.delete(sessions).where(eq(sessions.tokenHash, hashToken(token)))
    },
  }
}

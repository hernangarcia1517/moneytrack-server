import type { TypeBoxTypeProvider } from '@fastify/type-provider-typebox'
import { eq } from 'drizzle-orm'
import type { FastifyInstance } from 'fastify'
import { AppleTokenError, type VerifyApple } from '../auth/apple.js'
import { createSession } from '../auth/sessions.js'
import { testUserSession } from '../auth/testSession.js'
import { db } from '../db/client.js'
import { users } from '../db/schema.js'
import { AppleSignInBody, ErrorBody, SessionBody } from '../schemas.js'

export async function authRoutes(app: FastifyInstance, opts: { verifyApple: VerifyApple; testAuth: boolean }) {
  const r = app.withTypeProvider<TypeBoxTypeProvider>()

  if (opts.testAuth) {
    app.log.warn('Test-only sign-in is ON: POST /auth/test-session gives anyone a session. Never enable it outside moneytrack_test.')
    r.post('/auth/test-session', { schema: { response: { 200: SessionBody } } }, async () => ({
      sessionToken: await testUserSession(),
    }))
  }

  r.post(
    '/auth/apple',
    { schema: { body: AppleSignInBody, response: { 200: SessionBody, 401: ErrorBody } } },
    async (req, reply) => {
      let identity
      try {
        identity = await opts.verifyApple(req.body.identityToken, req.body.nonce)
      } catch (e) {
        if (e instanceof AppleTokenError) return reply.code(401).send({ error: 'Invalid Apple identity token' })
        throw e
      }

      // Apple sends the name and email once, so they are saved only when the user is first created.
      await db
        .insert(users)
        .values({ name: req.body.fullName?.trim() || 'User', email: identity.email, authProviderId: identity.sub })
        .onConflictDoNothing({ target: users.authProviderId })
      const [user] = await db.select({ id: users.id }).from(users).where(eq(users.authProviderId, identity.sub)).limit(1)
      return { sessionToken: await createSession(user!.id) }
    },
  )
}

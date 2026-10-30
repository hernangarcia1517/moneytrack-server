import Fastify from 'fastify'
import { verifyApple, type VerifyApple } from './auth/apple.js'
import { getCurrentUserId } from './auth/currentUser.js'
import { testAuthEnabled } from './auth/testSession.js'
import { authRoutes } from './routes/auth.js'
import { budgetRoutes } from './routes/budgets.js'
import { transactionRoutes } from './routes/transactions.js'

declare module 'fastify' {
  interface FastifyRequest {
    userId: string
  }
}

export function buildApp(opts: { logger?: boolean; verifyApple?: VerifyApple } = {}) {
  const app = Fastify({
    logger: opts.logger ?? false,
    ajv: {
      customOptions: {
        // Fastify's default is coerceTypes: 'array', which would quietly turn a JSON number
        // like 132.18 into the string "132.18" after it already went through floating point.
        // Money must arrive as a string, so a number has to be rejected instead.
        coerceTypes: false,
        // Reject unknown fields instead of silently stripping them.
        removeAdditional: false,
      },
    },
  })

  app.decorateRequest('userId', '')
  app.addHook('onRequest', async (req) => {
    req.userId = await getCurrentUserId(req)
  })

  app.register(authRoutes, { verifyApple: opts.verifyApple ?? verifyApple, testAuth: testAuthEnabled() })
  app.register(budgetRoutes)
  app.register(transactionRoutes)
  return app
}

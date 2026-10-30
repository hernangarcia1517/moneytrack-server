import type { FastifyReply, FastifyRequest } from 'fastify'
import { userIdForToken } from './sessions.js'

declare module 'fastify' {
  interface FastifyRequest {
    userId: string
    sessionToken: string
  }
  interface FastifyContextConfig {
    public?: boolean
  }
}

export async function authenticate(req: FastifyRequest, reply: FastifyReply) {
  if (req.routeOptions.config?.public) return
  const token = req.headers.authorization?.match(/^Bearer (.+)$/)?.[1]
  const userId = token ? await userIdForToken(token) : null
  if (!token || !userId) return reply.code(401).send({ error: 'Unauthorized' })
  req.userId = userId
  req.sessionToken = token
}

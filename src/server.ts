import 'dotenv/config'
import { sql } from 'drizzle-orm'
import { buildApp } from './app.js'
import { db } from './db/client.js'

const app = buildApp({ logger: true })
const port = Number(process.env.PORT ?? 3000)

// Localhost only for now; widen the host when the app needs to reach it from a device.
await app.listen({ port, host: '127.0.0.1' })

try {
  const result = await db.execute<{ name: string }>(sql`select current_database() as name`)
  app.log.info(`Connected to database "${result.rows[0]?.name}"`)
} catch (e) {
  app.log.warn(`Could not read the database name: ${(e as Error).message}`)
}

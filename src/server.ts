import 'dotenv/config'
import { buildApp } from './app.js'

const app = buildApp({ logger: true })
const port = Number(process.env.PORT ?? 3000)

// Localhost only for now; widen the host when the app needs to reach it from a device.
await app.listen({ port, host: '127.0.0.1' })

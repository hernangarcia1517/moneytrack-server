// Import this FIRST in every test file. The tests create and delete rows, so they must
// never run against the dev database. `npm test` loads .env.test (moneytrack_test).
const dbName = new URL(process.env.DATABASE_URL ?? 'postgres://invalid/none').pathname.slice(1)
if (dbName !== 'moneytrack_test') {
  throw new Error(`Refusing to run tests against database "${dbName}". Use \`npm test\` (loads .env.test).`)
}

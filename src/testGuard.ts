import { isTestDbName } from './testDbName.js'

// Import this FIRST in every test file. The tests create and delete rows, so they must
// never run against the dev database. `npm test` loads .env.test (moneytrack_test).
if (!isTestDbName(process.env.DATABASE_URL)) {
  throw new Error('Refusing to run tests against a database other than "moneytrack_test". Use `npm test` (loads .env.test).')
}

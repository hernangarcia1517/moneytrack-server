import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { describe, it } from 'node:test'

function loadGuard(databaseUrl: string) {
  return spawnSync(process.execPath, ['--import', 'tsx', '--input-type=module', '-e', "import './src/testGuard.ts'"], {
    env: { ...process.env, DATABASE_URL: databaseUrl },
    encoding: 'utf8',
  })
}

describe('testGuard', () => {
  it('lets the test database through', () => {
    assert.equal(loadGuard('postgres://u:p@localhost:5432/moneytrack_test').status, 0)
  })

  it('refuses the dev database', () => {
    const result = loadGuard('postgres://u:p@localhost:5432/moneytrack_db')
    assert.notEqual(result.status, 0)
    assert.match(result.stderr, /Refusing to run tests/)
  })

  it('refuses an unreadable URL without printing the password', () => {
    const result = loadGuard('postgres://u:secretpw@localhost:notaport/moneytrack_test')
    assert.notEqual(result.status, 0)
    assert.doesNotMatch(result.stderr, /secret/)
  })
})

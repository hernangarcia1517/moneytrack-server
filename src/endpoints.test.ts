import './testGuard.js'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { after, before, describe, it } from 'node:test'
import { buildApp } from './app.js'
import { closeDb } from './db/client.js'

// One happy-path test per endpoint (the 9 in moneytrack-server-endpoints.md), asserting
// the exact documented response. Error cases and behavior rules live in app.test.ts.
// Runs against the dev database as "hernan" and deletes the budgets it creates.
// Dates use 2031 and names start with "Contract" so they never collide with app.test.ts.
const app = buildApp()
const createdBudgets: string[] = []

const uniqueName = (label: string) => `Contract ${label} ${randomUUID().slice(0, 8)}`

async function createBudget(name: string, cap = '350.00', month = '2031-10') {
  const res = await app.inject({ method: 'POST', url: '/budgets', payload: { name, budgetGroup: 'Needs', cap, month } })
  assert.equal(res.statusCode, 201)
  createdBudgets.push(res.json().id)
  return res.json() as { id: string; name: string; budgetGroup: string; cap: string }
}

async function createTx(budgetId: string, over: Record<string, unknown> = {}) {
  const res = await app.inject({
    method: 'POST',
    url: '/transactions',
    payload: { budgetId, date: '2031-10-08T14:30:00Z', merchant: "Trader Joe's", amount: '42.17', note: 'weekly shop', ...over },
  })
  assert.equal(res.statusCode, 201)
  return res.json() as { id: string; budgetId: string; date: string; merchant: string; amount: string; note: string }
}

before(async () => {
  await app.ready()
})

after(async () => {
  for (const id of createdBudgets) await app.inject({ method: 'DELETE', url: `/budgets/${id}` })
  await app.close()
  await closeDb()
})

describe('the 9 endpoints, happy path', () => {
  it('POST /budgets -> 201 {id, name, budgetGroup, cap}', async () => {
    const name = uniqueName('post')
    const res = await app.inject({
      method: 'POST',
      url: '/budgets',
      payload: { name, budgetGroup: 'Needs', cap: '350.00', month: '2031-10' },
    })
    assert.equal(res.statusCode, 201)
    createdBudgets.push(res.json().id)
    assert.deepEqual(res.json(), { id: res.json().id, name, budgetGroup: 'Needs', cap: '350.00' })
  })

  it('GET /budgets?month= -> 200 list with the cap for that month, ordered by name ignoring case', async () => {
    const tag = randomUUID().slice(0, 8)
    const b = await createBudget(`b-${tag}`, '2.00')
    const a = await createBudget(`A-${tag}`, '1.00')
    const res = await app.inject({ method: 'GET', url: '/budgets?month=2031-10' })
    assert.equal(res.statusCode, 200)
    const mine = (res.json() as Array<{ id: string }>).filter((x) => [a.id, b.id].includes(x.id))
    assert.deepEqual(mine, [a, b])
  })

  it('PATCH /budgets/:id -> 200 {id, name, budgetGroup} (no cap)', async () => {
    const budget = await createBudget(uniqueName('patch'))
    const res = await app.inject({ method: 'PATCH', url: `/budgets/${budget.id}`, payload: { budgetGroup: 'Wants' } })
    assert.equal(res.statusCode, 200)
    assert.deepEqual(res.json(), { id: budget.id, name: budget.name, budgetGroup: 'Wants' })
  })

  it('PUT /budgets/:id/cap/:month -> 200 {budgetId, month, amount}, applies from that month on', async () => {
    const budget = await createBudget(uniqueName('put'))
    const res = await app.inject({ method: 'PUT', url: `/budgets/${budget.id}/cap/2031-12`, payload: { amount: '450.00' } })
    assert.equal(res.statusCode, 200)
    assert.deepEqual(res.json(), { budgetId: budget.id, month: '2031-12', amount: '450.00' })

    const capIn = async (month: string) =>
      (await app.inject({ method: 'GET', url: `/budgets?month=${month}` }))
        .json()
        .find((x: { id: string }) => x.id === budget.id).cap
    assert.deepEqual(await Promise.all(['2031-09', '2031-11', '2031-12', '2032-02'].map(capIn)), [
      '350.00',
      '350.00',
      '450.00',
      '450.00',
    ])
  })

  it('DELETE /budgets/:id -> 204 empty body, and its transactions go too', async () => {
    const budget = await createBudget(uniqueName('del'), '100.00', '2031-07')
    const tx = await createTx(budget.id, { date: '2031-07-08T14:30:00Z' })
    const res = await app.inject({ method: 'DELETE', url: `/budgets/${budget.id}` })
    assert.equal(res.statusCode, 204)
    assert.equal(res.body, '')
    const ids = (await app.inject({ method: 'GET', url: '/transactions?month=2031-07' })).json().map((t: { id: string }) => t.id)
    assert.ok(!ids.includes(tx.id))
  })

  it('POST /transactions -> 201 full transaction with a normalized date', async () => {
    const budget = await createBudget(uniqueName('txpost'))
    const tx = await createTx(budget.id)
    assert.deepEqual(tx, {
      id: tx.id,
      budgetId: budget.id,
      date: '2031-10-08T14:30:00.000Z',
      merchant: "Trader Joe's",
      amount: '42.17',
      note: 'weekly shop',
    })
  })

  it('GET /transactions?month= -> 200 list, newest first', async () => {
    const budget = await createBudget(uniqueName('txget'))
    const oldest = await createTx(budget.id, { date: '2031-05-01T08:00:00Z' })
    const newest = await createTx(budget.id, { date: '2031-05-20T08:00:00Z' })
    const middle = await createTx(budget.id, { date: '2031-05-10T08:00:00Z' })
    const res = await app.inject({ method: 'GET', url: '/transactions?month=2031-05' })
    assert.equal(res.statusCode, 200)
    const mine = (res.json() as Array<{ id: string }>).filter((t) => [oldest.id, middle.id, newest.id].includes(t.id))
    assert.deepEqual(mine, [newest, middle, oldest])
  })

  it('PATCH /transactions/:id -> 200 full updated transaction', async () => {
    const budget = await createBudget(uniqueName('txpatch'))
    const tx = await createTx(budget.id)
    const res = await app.inject({ method: 'PATCH', url: `/transactions/${tx.id}`, payload: { amount: '50.00', note: '' } })
    assert.equal(res.statusCode, 200)
    assert.deepEqual(res.json(), { ...tx, amount: '50.00', note: '' })
  })

  it('DELETE /transactions/:id -> 204 empty body', async () => {
    const budget = await createBudget(uniqueName('txdel'))
    const tx = await createTx(budget.id)
    const res = await app.inject({ method: 'DELETE', url: `/transactions/${tx.id}` })
    assert.equal(res.statusCode, 204)
    assert.equal(res.body, '')
  })
})

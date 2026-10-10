import './testGuard.js'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { after, before, describe, it } from 'node:test'
import { buildApp } from './app.js'
import { closeDb, db } from './db/client.js'
import { transactions } from './db/schema.js'
import { eq } from 'drizzle-orm'

// These run against the test database as the seeded "hernan" user and clean up the
// budgets they create (transactions and caps go with them).
const app = buildApp()
const createdBudgets: string[] = []

const uniqueName = (label: string) => `Test ${label} ${randomUUID().slice(0, 8)}`

async function createBudget(name: string, cap: string, month: string, budgetGroup = 'Needs') {
  const res = await app.inject({ method: 'POST', url: '/budgets', payload: { name, budgetGroup, cap, month } })
  if (res.statusCode === 201) createdBudgets.push(res.json().id)
  return res
}

async function capIn(budgetId: string, month: string) {
  const res = await app.inject({ method: 'GET', url: `/budgets?month=${month}` })
  assert.equal(res.statusCode, 200)
  return res.json().find((b: { id: string }) => b.id === budgetId)?.cap as string
}

before(async () => {
  await app.ready()
})

after(async () => {
  for (const id of createdBudgets) await app.inject({ method: 'DELETE', url: `/budgets/${id}` })
  await app.close()
  await closeDb()
})

describe('money is a string', () => {
  it('rejects a JSON number for a transaction amount instead of coercing it', async () => {
    const budget = (await createBudget(uniqueName('num'), '100.00', '2026-03')).json()
    const res = await app.inject({
      method: 'POST',
      url: '/transactions',
      payload: { budgetId: budget.id, date: '2026-03-05', merchant: 'Shop', amount: 132.18 },
    })
    assert.equal(res.statusCode, 400)
  })

  it('rejects a JSON number for a budget cap', async () => {
    const res = await createBudget(uniqueName('capnum'), 400 as unknown as string, '2026-03')
    assert.equal(res.statusCode, 400)
  })

  it('rejects amounts that are not exactly two decimals, or are zero for a transaction', async () => {
    const budget = (await createBudget(uniqueName('fmt'), '100.00', '2026-03')).json()
    for (const amount of ['5', '5.5', '5.555', '-5.00', '0.00', '1e3', '']) {
      const res = await app.inject({
        method: 'POST',
        url: '/transactions',
        payload: { budgetId: budget.id, date: '2026-03-05', merchant: 'Shop', amount },
      })
      assert.equal(res.statusCode, 400, `amount ${JSON.stringify(amount)} should be rejected`)
    }
  })

  it('returns amounts as strings with two decimals', async () => {
    const budget = (await createBudget(uniqueName('str'), '400.00', '2026-03')).json()
    assert.equal(budget.cap, '400.00')
    const created = await app.inject({
      method: 'POST',
      url: '/transactions',
      payload: { budgetId: budget.id, date: '2026-03-05', merchant: 'Shop', amount: '132.18' },
    })
    assert.equal(created.statusCode, 201)
    assert.equal(created.json().amount, '132.18')

    const list = await app.inject({ method: 'GET', url: '/transactions?month=2026-03' })
    const row = list.json().find((t: { id: string }) => t.id === created.json().id)
    assert.equal(typeof row.amount, 'string')
    assert.equal(row.amount, '132.18')
    assert.equal(row.note, '')
  })
})

describe('caps carry forward from the month they were set', () => {
  it('follows the example in the design doc', async () => {
    // Groceries created in March at $400, edited to $500 in September, then $450 in December.
    const { id } = (await createBudget(uniqueName('caps'), '400.00', '2026-03')).json()
    for (const [month, amount] of [['2026-09', '500.00'], ['2026-12', '450.00']] as const) {
      const res = await app.inject({ method: 'PUT', url: `/budgets/${id}/cap/${month}`, payload: { amount } })
      assert.equal(res.statusCode, 200)
      assert.deepEqual(res.json(), { budgetId: id, month, amount })
    }

    const expected: Record<string, string> = {
      '2026-01': '400.00', // before the first row: uses the earliest row
      '2026-02': '400.00',
      '2026-03': '400.00',
      '2026-08': '400.00',
      '2026-09': '500.00',
      '2026-11': '500.00',
      '2026-12': '450.00',
      '2027-06': '450.00',
    }
    for (const [month, cap] of Object.entries(expected)) assert.equal(await capIn(id, month), cap, month)

    // Editing June only changes the stretch until the next row (Jun-Aug).
    await app.inject({ method: 'PUT', url: `/budgets/${id}/cap/2026-06`, payload: { amount: '420.00' } })
    assert.equal(await capIn(id, '2026-05'), '400.00')
    assert.equal(await capIn(id, '2026-06'), '420.00')
    assert.equal(await capIn(id, '2026-08'), '420.00')
    assert.equal(await capIn(id, '2026-09'), '500.00')
  })

  it('updates the same month in place instead of adding a second row', async () => {
    const { id } = (await createBudget(uniqueName('upsert'), '200.00', '2026-01')).json()
    await app.inject({ method: 'PUT', url: `/budgets/${id}/cap/2026-02`, payload: { amount: '300.00' } })
    await app.inject({ method: 'PUT', url: `/budgets/${id}/cap/2026-02`, payload: { amount: '350.00' } })
    assert.equal(await capIn(id, '2026-01'), '200.00')
    assert.equal(await capIn(id, '2026-02'), '350.00')
  })

  it('returns 404 for a budget that does not exist', async () => {
    const res = await app.inject({
      method: 'PUT',
      url: `/budgets/${randomUUID()}/cap/2026-02`,
      payload: { amount: '300.00' },
    })
    assert.equal(res.statusCode, 404)
  })
})

describe('budgets', () => {
  it('rejects a duplicate name regardless of case', async () => {
    const name = uniqueName('dupe')
    assert.equal((await createBudget(name, '100.00', '2026-03')).statusCode, 201)
    assert.equal((await createBudget(name.toUpperCase(), '100.00', '2026-03')).statusCode, 409)
  })

  it('rejects an unknown group and unknown fields', async () => {
    assert.equal((await createBudget(uniqueName('grp'), '100.00', '2026-03', 'Luxury')).statusCode, 400)
    const res = await app.inject({
      method: 'POST',
      url: '/budgets',
      payload: { name: uniqueName('extra'), budgetGroup: 'Needs', cap: '1.00', month: '2026-03', surprise: true },
    })
    assert.equal(res.statusCode, 400)
  })

  it('renames and moves group, and rejects an empty patch', async () => {
    const { id } = (await createBudget(uniqueName('patch'), '100.00', '2026-03')).json()
    const renamed = uniqueName('renamed')
    const res = await app.inject({ method: 'PATCH', url: `/budgets/${id}`, payload: { name: renamed, budgetGroup: 'Wants' } })
    assert.equal(res.statusCode, 200)
    assert.deepEqual(res.json(), { id, name: renamed, budgetGroup: 'Wants' })
    assert.equal((await app.inject({ method: 'PATCH', url: `/budgets/${id}`, payload: {} })).statusCode, 400)
  })

  it('deleting a budget deletes its transactions and caps', async () => {
    const { id } = (await createBudget(uniqueName('cascade'), '100.00', '2026-03')).json()
    const tx = await app.inject({
      method: 'POST',
      url: '/transactions',
      payload: { budgetId: id, date: '2026-03-05', merchant: 'Shop', amount: '10.00' },
    })
    assert.equal(tx.statusCode, 201)

    assert.equal((await app.inject({ method: 'DELETE', url: `/budgets/${id}` })).statusCode, 204)
    const remaining = await db.select().from(transactions).where(eq(transactions.id, tx.json().id))
    assert.equal(remaining.length, 0)
    assert.equal((await app.inject({ method: 'DELETE', url: `/budgets/${id}` })).statusCode, 404)
  })
})

describe('transactions', () => {
  it('only lists transactions in the requested month', async () => {
    const { id } = (await createBudget(uniqueName('month'), '100.00', '2026-03')).json()
    const post = (date: string) =>
      app.inject({
        method: 'POST',
        url: '/transactions',
        payload: { budgetId: id, date, merchant: 'Shop', amount: '10.00' },
      })
    const inMarch = (await post('2026-03-31')).json()
    const inApril = (await post('2026-04-01')).json()

    const ids = (month: string) =>
      app.inject({ method: 'GET', url: `/transactions?month=${month}` }).then((r) => r.json().map((t: { id: string }) => t.id))
    assert.ok((await ids('2026-03')).includes(inMarch.id))
    assert.ok(!(await ids('2026-03')).includes(inApril.id))
    assert.ok((await ids('2026-04')).includes(inApril.id))
  })

  it('patches and deletes a transaction', async () => {
    const { id } = (await createBudget(uniqueName('txedit'), '100.00', '2026-03')).json()
    const tx = (
      await app.inject({
        method: 'POST',
        url: '/transactions',
        payload: { budgetId: id, date: '2026-03-05', merchant: 'Shop', amount: '10.00' },
      })
    ).json()
    const patched = await app.inject({
      method: 'PATCH',
      url: `/transactions/${tx.id}`,
      payload: { amount: '12.50', note: 'edited' },
    })
    assert.equal(patched.statusCode, 200)
    assert.equal(patched.json().amount, '12.50')
    assert.equal(patched.json().note, 'edited')
    assert.equal((await app.inject({ method: 'DELETE', url: `/transactions/${tx.id}` })).statusCode, 204)
    assert.equal((await app.inject({ method: 'DELETE', url: `/transactions/${tx.id}` })).statusCode, 404)
  })

  it('rejects a date-time and an impossible day: dates are calendar days', async () => {
    const { id } = (await createBudget(uniqueName('badday'), '100.00', '2026-03')).json()
    for (const date of ['2026-03-05T12:00:00Z', '2026-02-30', '2026-3-5', 'yesterday']) {
      const res = await app.inject({
        method: 'POST',
        url: '/transactions',
        payload: { budgetId: id, date, merchant: 'Shop', amount: '10.00' },
      })
      assert.equal(res.statusCode, 400, date)
    }
  })

  it('keeps a transaction on the day it was given, in every month boundary case', async () => {
    const { id } = (await createBudget(uniqueName('edge'), '100.00', '2026-03')).json()
    const post = async (date: string) =>
      (await app.inject({ method: 'POST', url: '/transactions', payload: { budgetId: id, date, merchant: 'Shop', amount: '10.00' } })).json()
    const lastOfYear = await post('2026-12-31')
    const firstOfYear = await post('2027-01-01')
    assert.equal(lastOfYear.date, '2026-12-31')
    assert.equal(firstOfYear.date, '2027-01-01')
    const ids = (month: string) =>
      app.inject({ method: 'GET', url: `/transactions?month=${month}` }).then((r) => r.json().map((t: { id: string }) => t.id))
    assert.ok((await ids('2026-12')).includes(lastOfYear.id))
    assert.ok(!(await ids('2026-12')).includes(firstOfYear.id))
    assert.ok((await ids('2027-01')).includes(firstOfYear.id))
  })

  it('orders the same day by when it was entered, newest first', async () => {
    const { id } = (await createBudget(uniqueName('order'), '100.00', '2026-03')).json()
    const post = async (merchant: string) =>
      (await app.inject({ method: 'POST', url: '/transactions', payload: { budgetId: id, date: '2026-03-10', merchant, amount: '1.00' } })).json()
    const first = await post('First')
    const second = await post('Second')
    const listed = (await app.inject({ method: 'GET', url: '/transactions?month=2026-03' })).json() as Array<{ id: string }>
    const mine = listed.filter((t) => t.id === first.id || t.id === second.id).map((t) => t.id)
    assert.deepEqual(mine, [second.id, first.id])
  })

  it('moves a transaction to another month when its date is patched', async () => {
    const { id } = (await createBudget(uniqueName('move'), '100.00', '2026-03')).json()
    const tx = (await app.inject({ method: 'POST', url: '/transactions', payload: { budgetId: id, date: '2026-03-31', merchant: 'Shop', amount: '10.00' } })).json()
    const patched = await app.inject({ method: 'PATCH', url: `/transactions/${tx.id}`, payload: { date: '2026-04-01' } })
    assert.equal(patched.statusCode, 200)
    assert.equal(patched.json().date, '2026-04-01')
    const ids = (month: string) =>
      app.inject({ method: 'GET', url: `/transactions?month=${month}` }).then((r) => r.json().map((t: { id: string }) => t.id))
    assert.ok(!(await ids('2026-03')).includes(tx.id))
    assert.ok((await ids('2026-04')).includes(tx.id))
  })

  it('404s when the budget does not exist', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/transactions',
      payload: { budgetId: randomUUID(), date: '2026-03-05', merchant: 'Shop', amount: '10.00' },
    })
    assert.equal(res.statusCode, 404)
  })
})

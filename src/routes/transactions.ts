import type { TypeBoxTypeProvider } from '@fastify/type-provider-typebox'
import { and, desc, eq, gte, inArray, lt } from 'drizzle-orm'
import type { FastifyInstance } from 'fastify'
import { Type } from 'typebox'
import { db } from '../db/client.js'
import { budgets, transactions } from '../db/schema.js'
import { ErrorBody, Id, Month, PositiveMoney, Transaction } from '../schemas.js'

const columns = {
  id: transactions.id,
  budgetId: transactions.budgetId,
  date: transactions.date,
  merchant: transactions.merchant,
  amount: transactions.amount,
  note: transactions.note,
}

const toJson = (row: { id: string; budgetId: string; date: Date; merchant: string; amount: string; note: string }) => ({
  ...row,
  date: row.date.toISOString(),
})

export async function transactionRoutes(app: FastifyInstance) {
  const r = app.withTypeProvider<TypeBoxTypeProvider>()

  const ownedBudgetIds = (userId: string) =>
    db.select({ id: budgets.id }).from(budgets).where(eq(budgets.userId, userId))

  const ownsBudget = async (userId: string, budgetId: string) => {
    const [row] = await db
      .select({ id: budgets.id })
      .from(budgets)
      .where(and(eq(budgets.id, budgetId), eq(budgets.userId, userId)))
    return row !== undefined
  }

  // TODO(open question): months are cut at UTC midnight for now. Which time zone decides
  // what counts as "September" is not settled in the design doc.
  r.get(
    '/transactions',
    {
      schema: {
        querystring: Type.Object({ month: Month }, { additionalProperties: false }),
        response: { 200: Type.Array(Transaction) },
      },
    },
    async (req) => {
      const [year, month] = req.query.month.split('-').map(Number) as [number, number]
      const start = new Date(Date.UTC(year, month - 1, 1))
      const end = new Date(Date.UTC(year, month, 1))
      const rows = await db
        .select(columns)
        .from(transactions)
        .where(
          and(
            inArray(transactions.budgetId, ownedBudgetIds(req.userId)),
            gte(transactions.date, start),
            lt(transactions.date, end),
          ),
        )
        .orderBy(desc(transactions.date))
      return rows.map(toJson)
    },
  )

  r.post(
    '/transactions',
    {
      schema: {
        body: Type.Object(
          {
            budgetId: Id,
            date: Type.String({ format: 'date-time' }),
            merchant: Type.String({ minLength: 1 }),
            amount: PositiveMoney,
            note: Type.Optional(Type.String()),
          },
          { additionalProperties: false },
        ),
        response: { 201: Transaction, 404: ErrorBody },
      },
    },
    async (req, reply) => {
      const { budgetId, date, merchant, amount, note } = req.body
      if (!(await ownsBudget(req.userId, budgetId))) return reply.code(404).send({ error: 'Budget not found' })
      const [created] = await db
        .insert(transactions)
        .values({ budgetId, date: new Date(date), merchant, amount, note: note ?? '' })
        .returning(columns)
      return reply.code(201).send(toJson(created!))
    },
  )

  r.patch(
    '/transactions/:id',
    {
      schema: {
        params: Type.Object({ id: Id }),
        body: Type.Object(
          {
            budgetId: Type.Optional(Id),
            date: Type.Optional(Type.String({ format: 'date-time' })),
            merchant: Type.Optional(Type.String({ minLength: 1 })),
            amount: Type.Optional(PositiveMoney),
            note: Type.Optional(Type.String()),
          },
          { additionalProperties: false, minProperties: 1 },
        ),
        response: { 200: Transaction, 404: ErrorBody },
      },
    },
    async (req, reply) => {
      const { date, ...rest } = req.body
      if (rest.budgetId && !(await ownsBudget(req.userId, rest.budgetId))) {
        return reply.code(404).send({ error: 'Budget not found' })
      }
      const [updated] = await db
        .update(transactions)
        .set({ ...rest, ...(date ? { date: new Date(date) } : {}) })
        .where(and(eq(transactions.id, req.params.id), inArray(transactions.budgetId, ownedBudgetIds(req.userId))))
        .returning(columns)
      if (!updated) return reply.code(404).send({ error: 'Transaction not found' })
      return toJson(updated)
    },
  )

  r.delete(
    '/transactions/:id',
    { schema: { params: Type.Object({ id: Id }), response: { 204: Type.Null(), 404: ErrorBody } } },
    async (req, reply) => {
      const deleted = await db
        .delete(transactions)
        .where(and(eq(transactions.id, req.params.id), inArray(transactions.budgetId, ownedBudgetIds(req.userId))))
        .returning({ id: transactions.id })
      if (deleted.length === 0) return reply.code(404).send({ error: 'Transaction not found' })
      return reply.code(204).send(null)
    },
  )
}

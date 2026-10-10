import type { TypeBoxTypeProvider } from '@fastify/type-provider-typebox'
import { and, asc, desc, eq, gte, inArray, lt } from 'drizzle-orm'
import type { FastifyInstance } from 'fastify'
import { Type } from 'typebox'
import { db } from '../db/client.js'
import { budgets, transactions } from '../db/schema.js'
import { CalendarDate, ErrorBody, Id, Month, PositiveMoney, Transaction } from '../schemas.js'

const columns = {
  id: transactions.id,
  budgetId: transactions.budgetId,
  date: transactions.date,
  merchant: transactions.merchant,
  amount: transactions.amount,
  note: transactions.note,
}

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
      const start = `${req.query.month}-01`
      const end = month === 12 ? `${year + 1}-01-01` : `${year}-${String(month + 1).padStart(2, '0')}-01`
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
        .orderBy(desc(transactions.date), desc(transactions.createdAt), asc(transactions.id))
      return rows
    },
  )

  r.post(
    '/transactions',
    {
      schema: {
        body: Type.Object(
          {
            budgetId: Id,
            date: CalendarDate,
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
        .values({ budgetId, date, merchant, amount, note: note ?? '' })
        .returning(columns)
      return reply.code(201).send(created!)
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
            date: Type.Optional(CalendarDate),
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
      if (req.body.budgetId && !(await ownsBudget(req.userId, req.body.budgetId))) {
        return reply.code(404).send({ error: 'Budget not found' })
      }
      const [updated] = await db
        .update(transactions)
        .set(req.body)
        .where(and(eq(transactions.id, req.params.id), inArray(transactions.budgetId, ownedBudgetIds(req.userId))))
        .returning(columns)
      if (!updated) return reply.code(404).send({ error: 'Transaction not found' })
      return updated
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

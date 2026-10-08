import type { TypeBoxTypeProvider } from '@fastify/type-provider-typebox'
import { and, eq, sql } from 'drizzle-orm'
import type { FastifyInstance } from 'fastify'
import { Type } from 'typebox'
import { db } from '../db/client.js'
import { budgetCaps, budgets } from '../db/schema.js'
import { Budget, BudgetGroup, BudgetWithCap, ErrorBody, Id, Money, Month } from '../schemas.js'

const monthStart = (month: string) => `${month}-01`

function isUniqueViolation(e: unknown): boolean {
  const err = e as { code?: string; cause?: { code?: string } }
  return (err.cause?.code ?? err.code) === '23505'
}

export async function budgetRoutes(app: FastifyInstance) {
  const r = app.withTypeProvider<TypeBoxTypeProvider>()

  // The cap for a month is the latest budget_caps row at or before that month. A month
  // earlier than every row uses the earliest row.
  r.get(
    '/budgets',
    {
      schema: {
        querystring: Type.Object({ month: Month }, { additionalProperties: false }),
        response: { 200: Type.Array(BudgetWithCap) },
      },
    },
    async (req) => {
      const month = monthStart(req.query.month)
      const result = await db.execute<{ id: string; name: string; budgetGroup: string; cap: string }>(sql`
        select b.id, b.name, b.budget_group as "budgetGroup",
          coalesce(
            (select c.amount from budget_caps c
              where c.budget_id = b.id and c.effective_month <= ${month}::date
              order by c.effective_month desc limit 1),
            (select c.amount from budget_caps c
              where c.budget_id = b.id
              order by c.effective_month asc limit 1)
          ) as cap
        from budgets b
        where b.user_id = ${req.userId}
        order by lower(b.name)
      `)
      return result.rows as Array<{ id: string; name: string; budgetGroup: 'Bills' | 'Needs' | 'Wants'; cap: string }>
    },
  )

  // `month` is the month the budget is created in; it gets the first cap row.
  r.post(
    '/budgets',
    {
      schema: {
        body: Type.Object(
          { name: Type.String({ minLength: 1 }), budgetGroup: BudgetGroup, cap: Money, month: Month },
          { additionalProperties: false },
        ),
        response: { 201: BudgetWithCap, 409: ErrorBody },
      },
    },
    async (req, reply) => {
      const { name, budgetGroup, cap, month } = req.body
      try {
        const created = await db.transaction(async (tx) => {
          const [budget] = await tx
            .insert(budgets)
            .values({ userId: req.userId, name, budgetGroup })
            .returning({ id: budgets.id, name: budgets.name, budgetGroup: budgets.budgetGroup })
          await tx.insert(budgetCaps).values({ budgetId: budget!.id, effectiveMonth: monthStart(month), amount: cap })
          return budget!
        })
        return reply.code(201).send({ ...created, budgetGroup: created.budgetGroup as 'Bills' | 'Needs' | 'Wants', cap })
      } catch (e) {
        if (isUniqueViolation(e)) return reply.code(409).send({ error: 'A budget with that name already exists' })
        throw e
      }
    },
  )

  r.patch(
    '/budgets/:id',
    {
      schema: {
        params: Type.Object({ id: Id }),
        body: Type.Object(
          { name: Type.Optional(Type.String({ minLength: 1 })), budgetGroup: Type.Optional(BudgetGroup) },
          { additionalProperties: false, minProperties: 1 },
        ),
        response: { 200: Budget, 404: ErrorBody, 409: ErrorBody },
      },
    },
    async (req, reply) => {
      try {
        const [updated] = await db
          .update(budgets)
          .set(req.body)
          .where(and(eq(budgets.id, req.params.id), eq(budgets.userId, req.userId)))
          .returning({ id: budgets.id, name: budgets.name, budgetGroup: budgets.budgetGroup })
        if (!updated) return reply.code(404).send({ error: 'Budget not found' })
        return { ...updated, budgetGroup: updated.budgetGroup as 'Bills' | 'Needs' | 'Wants' }
      } catch (e) {
        if (isUniqueViolation(e)) return reply.code(409).send({ error: 'A budget with that name already exists' })
        throw e
      }
    },
  )

  // Transactions and caps go with it (foreign keys cascade).
  r.delete(
    '/budgets/:id',
    { schema: { params: Type.Object({ id: Id }), response: { 204: Type.Null(), 404: ErrorBody } } },
    async (req, reply) => {
      const deleted = await db
        .delete(budgets)
        .where(and(eq(budgets.id, req.params.id), eq(budgets.userId, req.userId)))
        .returning({ id: budgets.id })
      if (deleted.length === 0) return reply.code(404).send({ error: 'Budget not found' })
      return reply.code(204).send(null)
    },
  )

  // Sets the cap from that month on: insert, or update that month's row if it exists.
  r.put(
    '/budgets/:id/cap/:month',
    {
      schema: {
        params: Type.Object({ id: Id, month: Month }),
        body: Type.Object({ amount: Money }, { additionalProperties: false }),
        response: { 200: Type.Object({ budgetId: Id, month: Month, amount: Money }), 404: ErrorBody },
      },
    },
    async (req, reply) => {
      const { id, month } = req.params
      const [owned] = await db
        .select({ id: budgets.id })
        .from(budgets)
        .where(and(eq(budgets.id, id), eq(budgets.userId, req.userId)))
      if (!owned) return reply.code(404).send({ error: 'Budget not found' })

      await db
        .insert(budgetCaps)
        .values({ budgetId: id, effectiveMonth: monthStart(month), amount: req.body.amount })
        .onConflictDoUpdate({
          target: [budgetCaps.budgetId, budgetCaps.effectiveMonth],
          set: { amount: req.body.amount },
        })
      return { budgetId: id, month, amount: req.body.amount }
    },
  )
}

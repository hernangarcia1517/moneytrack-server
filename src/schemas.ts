import { Type } from 'typebox'

// Money travels as a string like "132.18", never a JSON number (a number would pass
// through floating point). Exactly two decimals, up to numeric(12,2).
export const Money = Type.String({ pattern: '^\\d{1,10}\\.\\d{2}$' })
// Transactions are spending only, so zero is rejected here before the database check.
export const PositiveMoney = Type.String({ pattern: '^(?!0+\\.00$)\\d{1,10}\\.\\d{2}$' })

export const Month = Type.String({ pattern: '^\\d{4}-(0[1-9]|1[0-2])$' })
export const Id = Type.String({ format: 'uuid' })

export const BudgetGroup = Type.Union([
  Type.Literal('Bills'),
  Type.Literal('Needs'),
  Type.Literal('Wants'),
])

export const Budget = Type.Object({
  id: Id,
  name: Type.String(),
  budgetGroup: BudgetGroup,
})

export const BudgetWithCap = Type.Object({
  id: Id,
  name: Type.String(),
  budgetGroup: BudgetGroup,
  cap: Money,
})

export const Transaction = Type.Object({
  id: Id,
  budgetId: Id,
  date: Type.String(),
  merchant: Type.String(),
  amount: Money,
  note: Type.String(),
})

export const ErrorBody = Type.Object({ error: Type.String() })

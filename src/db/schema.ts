import { sql } from 'drizzle-orm'
import {
  check,
  date,
  numeric,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core'

// Money is numeric(12,2) and comes back from the driver as a string, never a JS number.
const money = (name: string) => numeric(name, { precision: 12, scale: 2 })

export const users = pgTable('users', {
  id: uuid().primaryKey().defaultRandom(),
  name: text().notNull(),
  email: text(),
  authProviderId: text('auth_provider_id').unique(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})

export const budgets = pgTable(
  'budgets',
  {
    id: uuid().primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    name: text().notNull(),
    budgetGroup: text('budget_group').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // Names are unique per user, case-insensitive (matches isNameTaken in the app).
    uniqueIndex('budgets_user_lower_name_idx').on(t.userId, sql`lower(${t.name})`),
    check('budgets_group_check', sql`${t.budgetGroup} in ('Bills', 'Needs', 'Wants')`),
  ],
)

export const transactions = pgTable(
  'transactions',
  {
    id: uuid().primaryKey().defaultRandom(),
    budgetId: uuid('budget_id')
      .notNull()
      .references(() => budgets.id, { onDelete: 'cascade' }),
    // The day the user says this belongs to; independent of created_at, the UTC instant it was recorded.
    date: date('date', { mode: 'string' }).notNull(),
    merchant: text().notNull(),
    amount: money('amount').notNull(),
    note: text().notNull().default(''),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [check('transactions_amount_positive', sql`${t.amount} > 0`)],
)

export const budgetCaps = pgTable(
  'budget_caps',
  {
    budgetId: uuid('budget_id')
      .notNull()
      .references(() => budgets.id, { onDelete: 'cascade' }),
    // Always the 1st of a month. The cap applies from this month on, until the next row.
    effectiveMonth: date('effective_month', { mode: 'string' }).notNull(),
    amount: money('amount').notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.budgetId, t.effectiveMonth] }),
    check('budget_caps_amount_nonnegative', sql`${t.amount} >= 0`),
    check('budget_caps_first_of_month', sql`extract(day from ${t.effectiveMonth}) = 1`),
  ],
)

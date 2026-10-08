CREATE TABLE "budget_caps" (
	"budget_id" uuid NOT NULL,
	"effective_month" date NOT NULL,
	"amount" numeric(12, 2) NOT NULL,
	CONSTRAINT "budget_caps_budget_id_effective_month_pk" PRIMARY KEY("budget_id","effective_month"),
	CONSTRAINT "budget_caps_amount_nonnegative" CHECK ("budget_caps"."amount" >= 0),
	CONSTRAINT "budget_caps_first_of_month" CHECK (extract(day from "budget_caps"."effective_month") = 1)
);
--> statement-breakpoint
CREATE TABLE "budgets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"name" text NOT NULL,
	"budget_group" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "budgets_group_check" CHECK ("budgets"."budget_group" in ('Bills', 'Needs', 'Wants'))
);
--> statement-breakpoint
CREATE TABLE "transactions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"budget_id" uuid NOT NULL,
	"date" timestamp with time zone NOT NULL,
	"merchant" text NOT NULL,
	"amount" numeric(12, 2) NOT NULL,
	"note" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "transactions_amount_positive" CHECK ("transactions"."amount" > 0)
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"email" text,
	"auth_provider_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_auth_provider_id_unique" UNIQUE("auth_provider_id")
);
--> statement-breakpoint
ALTER TABLE "budget_caps" ADD CONSTRAINT "budget_caps_budget_id_budgets_id_fk" FOREIGN KEY ("budget_id") REFERENCES "public"."budgets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "budgets" ADD CONSTRAINT "budgets_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_budget_id_budgets_id_fk" FOREIGN KEY ("budget_id") REFERENCES "public"."budgets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "budgets_user_lower_name_idx" ON "budgets" USING btree ("user_id",lower("name"));
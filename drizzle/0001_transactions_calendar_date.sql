-- Convert in UTC explicitly; the bare cast would use the migrating session's time zone.
ALTER TABLE "transactions" ALTER COLUMN "date" SET DATA TYPE date USING ("date" AT TIME ZONE 'UTC')::date;
--> statement-breakpoint
-- Print timestamptz values (created_at) in UTC in every session.
DO $$ BEGIN EXECUTE format('ALTER DATABASE %I SET timezone = ''UTC''', current_database()); END $$;

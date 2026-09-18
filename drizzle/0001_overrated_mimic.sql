ALTER TABLE "payment_attempts" ADD COLUMN "actor" text DEFAULT 'system' NOT NULL;--> statement-breakpoint
ALTER TABLE "payment_attempts" ADD COLUMN "reason" text;
ALTER TABLE "agent_runs" ADD COLUMN "usage" jsonb DEFAULT '{"inputTokens":0,"outputTokens":0}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "agent_runs" ADD COLUMN "duration_ms" integer;--> statement-breakpoint
ALTER TABLE "agent_runs" ADD COLUMN "events" jsonb DEFAULT '[]'::jsonb NOT NULL;
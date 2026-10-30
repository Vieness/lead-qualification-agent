ALTER TABLE "agent_runs" ADD COLUMN "route_log" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "agent_runs" ADD COLUMN "notes" jsonb DEFAULT '[]'::jsonb NOT NULL;
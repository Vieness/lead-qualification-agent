CREATE TYPE "public"."agent_name" AS ENUM('supervisor', 'research', 'matching', 'writer');--> statement-breakpoint
CREATE TYPE "public"."decision" AS ENUM('auto_reply', 'human_review', 'reject');--> statement-breakpoint
CREATE TYPE "public"."lead_source" AS ENUM('web_form', 'email');--> statement-breakpoint
CREATE TYPE "public"."run_status" AS ENUM('completed', 'pending_approval', 'rejected', 'failed');--> statement-breakpoint
CREATE TYPE "public"."service" AS ENUM('web', 'mobile', 'design', 'branding', 'marketing', 'ai_automation', 'other');--> statement-breakpoint
CREATE TYPE "public"."tier" AS ENUM('hot', 'warm', 'cold', 'spam');--> statement-breakpoint
CREATE TYPE "public"."tool_name" AS ENUM('extract_requirements', 'enrich_company', 'search_portfolio', 'score_lead', 'draft_reply', 'save_to_crm');--> statement-breakpoint
CREATE TABLE "agent_runs" (
	"id" uuid PRIMARY KEY NOT NULL,
	"lead_id" uuid,
	"status" "run_status",
	"llm_provider" text NOT NULL,
	"model" text,
	"prompt_versions" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"steps" integer DEFAULT 0 NOT NULL,
	"retries" integer DEFAULT 0 NOT NULL,
	"findings" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"error" text,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "leads" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"company" text,
	"website" text,
	"message" text NOT NULL,
	"source" "lead_source" NOT NULL,
	"status" "run_status" NOT NULL,
	"decision" "decision" NOT NULL,
	"tier" "tier" NOT NULL,
	"score" integer NOT NULL,
	"outcome" jsonb NOT NULL,
	"approved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "portfolio_cases" (
	"id" text PRIMARY KEY NOT NULL,
	"title" text NOT NULL,
	"services" "service"[] NOT NULL,
	"industry" text NOT NULL,
	"summary" text NOT NULL,
	"body" text NOT NULL,
	"search" "tsvector" GENERATED ALWAYS AS (
          setweight(to_tsvector('english', "portfolio_cases"."title"), 'A') ||
          setweight(to_tsvector('english', "portfolio_cases"."summary" || ' ' || "portfolio_cases"."industry"), 'B') ||
          setweight(to_tsvector('english', "portfolio_cases"."body"), 'C')) STORED NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tool_calls" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"run_id" uuid NOT NULL,
	"step" integer NOT NULL,
	"agent" "agent_name" NOT NULL,
	"tool" "tool_name" NOT NULL,
	"args" jsonb NOT NULL,
	"result" jsonb,
	"error" text,
	"latency_ms" integer NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	CONSTRAINT "tool_calls_run_step_uq" UNIQUE("run_id","step")
);
--> statement-breakpoint
ALTER TABLE "agent_runs" ADD CONSTRAINT "agent_runs_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tool_calls" ADD CONSTRAINT "tool_calls_run_id_agent_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."agent_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "leads_status_created_idx" ON "leads" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "leads_email_idx" ON "leads" USING btree ("email");--> statement-breakpoint
CREATE INDEX "portfolio_cases_search_idx" ON "portfolio_cases" USING gin ("search");
ALTER TABLE "analysis_runs"
ADD COLUMN "client_ip" text NOT NULL DEFAULT 'unknown';
--> statement-breakpoint
ALTER TABLE "analysis_runs"
ADD COLUMN "trace_id" text;

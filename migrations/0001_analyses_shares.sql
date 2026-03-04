CREATE TABLE "analysis_runs" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"share_id" text NOT NULL,
	"moxfield_url" text NOT NULL,
	"payload_json" jsonb NOT NULL,
	"input_json" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "analysis_runs_share_id_unique" ON "analysis_runs" USING btree ("share_id");
--> statement-breakpoint
CREATE INDEX "idx_analysis_runs_created_at" ON "analysis_runs" USING btree ("created_at");

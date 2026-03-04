CREATE TABLE "duel_commander_banlist_cache" (
	"key" text PRIMARY KEY NOT NULL,
	"source_url" text NOT NULL,
	"cards_json" jsonb NOT NULL,
	"fetched_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "idx_duel_commander_banlist_cache_fetched_at" ON "duel_commander_banlist_cache" USING btree ("fetched_at");

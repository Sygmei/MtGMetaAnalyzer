CREATE TABLE "mtgtop8_commanders" (
	"slug" text PRIMARY KEY NOT NULL,
	"commander_name" text NOT NULL,
	"commander_url" text NOT NULL,
	"moxfield_commander_query" text NOT NULL,
	"match_score" double precision DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mtgtop8_decks" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"commander_slug" text NOT NULL,
	"deck_url" text NOT NULL,
	"page_url" text NOT NULL,
	"deck_name" text NOT NULL,
	"player_name" text NOT NULL,
	"event_name" text NOT NULL,
	"event_level" text NOT NULL,
	"deck_rank" text NOT NULL,
	"event_date" date NOT NULL,
	"event_date_raw" text NOT NULL,
	"cards_json" jsonb NOT NULL,
	"sections_json" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "mtgtop8_decks" ADD CONSTRAINT "mtgtop8_decks_commander_slug_mtgtop8_commanders_slug_fk" FOREIGN KEY ("commander_slug") REFERENCES "public"."mtgtop8_commanders"("slug") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "mtgtop8_commanders_commander_url_unique" ON "mtgtop8_commanders" USING btree ("commander_url");--> statement-breakpoint
CREATE UNIQUE INDEX "mtgtop8_decks_deck_url_unique" ON "mtgtop8_decks" USING btree ("deck_url");--> statement-breakpoint
CREATE INDEX "idx_mtgtop8_decks_commander_date" ON "mtgtop8_decks" USING btree ("commander_slug","event_date");--> statement-breakpoint
CREATE INDEX "idx_mtgtop8_decks_commander_deck_url" ON "mtgtop8_decks" USING btree ("commander_slug","deck_url");

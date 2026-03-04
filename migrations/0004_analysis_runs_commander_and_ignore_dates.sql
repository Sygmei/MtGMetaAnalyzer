ALTER TABLE "analysis_runs"
ADD COLUMN IF NOT EXISTS "commander_name" text;

ALTER TABLE "analysis_runs"
ADD COLUMN IF NOT EXISTS "ignore_before" date;

ALTER TABLE "analysis_runs"
ADD COLUMN IF NOT EXISTS "ignore_after" date;

UPDATE "analysis_runs"
SET "commander_name" = COALESCE("commander_name", payload_json->'commander'->>'name');

UPDATE "analysis_runs"
SET
  "ignore_before" = COALESCE("ignore_before", NULLIF(input_json->>'startDate', '')::date),
  "ignore_after" = COALESCE("ignore_after", NULLIF(input_json->>'endDate', '')::date);

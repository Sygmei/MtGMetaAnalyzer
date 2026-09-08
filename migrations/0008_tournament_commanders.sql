ALTER TABLE tournament_results
  ADD COLUMN commanders TEXT NOT NULL DEFAULT '',
  ADD CONSTRAINT tournament_results_commanders_length CHECK (char_length(commanders) <= 300);

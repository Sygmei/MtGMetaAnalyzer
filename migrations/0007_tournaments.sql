CREATE TABLE tournament_leagues (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  starts_on DATE NOT NULL,
  ends_on DATE NOT NULL,
  archived BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT tournament_league_dates CHECK (ends_on >= starts_on)
);

CREATE TABLE tournament_members (
  id TEXT PRIMARY KEY,
  league_id TEXT NOT NULL REFERENCES tournament_leagues(id) ON DELETE RESTRICT,
  user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  joined_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (league_id, user_id),
  UNIQUE (league_id, id)
);

CREATE TABLE tournament_events (
  id TEXT PRIMARY KEY,
  league_id TEXT NOT NULL REFERENCES tournament_leagues(id) ON DELETE RESTRICT,
  name TEXT NOT NULL,
  event_date DATE NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published')),
  revision INTEGER NOT NULL DEFAULT 0 CHECK (revision >= 0),
  scoring_version TEXT NOT NULL DEFAULT 'log2-2.5-v1',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (league_id, id)
);
CREATE INDEX tournament_events_league_date ON tournament_events (league_id, event_date);

CREATE TABLE tournament_results (
  id TEXT PRIMARY KEY,
  league_id TEXT NOT NULL,
  event_id TEXT NOT NULL,
  member_id TEXT NOT NULL,
  rank INTEGER NOT NULL CHECK (rank > 0),
  points INTEGER NOT NULL CHECK (points > 0),
  FOREIGN KEY (league_id, event_id) REFERENCES tournament_events(league_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (league_id, member_id) REFERENCES tournament_members(league_id, id) ON DELETE RESTRICT,
  UNIQUE (event_id, member_id),
  UNIQUE (event_id, rank)
);
CREATE INDEX tournament_results_league ON tournament_results (league_id);

CREATE TABLE tournament_event_history (
  id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL REFERENCES tournament_events(id) ON DELETE RESTRICT,
  revision INTEGER NOT NULL,
  actor_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  actor_name TEXT NOT NULL,
  reason TEXT NOT NULL DEFAULT '',
  snapshot JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (event_id, revision)
);

-- Pulsar: status pages, their components and incidents (scheduled maintenance is an incident of
-- kind 'maintenance'), and the admins who run them. Times are ISO 8601 text (UTC).

CREATE TABLE pages (
  id         TEXT PRIMARY KEY,                 -- 12 characters, a-z0-9 (as Statuspage's ids)
  slug       TEXT NOT NULL UNIQUE,             -- the page's address: /p/<slug>
  name       TEXT NOT NULL,
  time_zone  TEXT NOT NULL DEFAULT 'Europe/Oslo',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE components (
  id          TEXT PRIMARY KEY,
  page_id     TEXT NOT NULL REFERENCES pages(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  description TEXT,
  status      TEXT NOT NULL DEFAULT 'operational'
              CHECK (status IN ('operational', 'degraded_performance', 'partial_outage', 'major_outage', 'under_maintenance')),
  position    INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);
CREATE INDEX components_page ON components (page_id, position);

CREATE TABLE incidents (
  id              TEXT PRIMARY KEY,
  page_id         TEXT NOT NULL REFERENCES pages(id) ON DELETE CASCADE,
  kind            TEXT NOT NULL DEFAULT 'incident' CHECK (kind IN ('incident', 'maintenance')),
  name            TEXT NOT NULL,
  -- incident: investigating, identified, monitoring, resolved, postmortem
  -- maintenance: scheduled, in_progress, verifying, completed
  status          TEXT NOT NULL,
  impact          TEXT NOT NULL DEFAULT 'minor' CHECK (impact IN ('none', 'minor', 'major', 'critical', 'maintenance')),
  created_at      TEXT NOT NULL,
  updated_at      TEXT NOT NULL,
  started_at      TEXT NOT NULL,
  monitoring_at   TEXT,
  resolved_at     TEXT,
  scheduled_for   TEXT,
  scheduled_until TEXT
);
CREATE INDEX incidents_page ON incidents (page_id, created_at DESC);

-- The components an incident affects (and what it set them to).
CREATE TABLE incident_components (
  incident_id  TEXT NOT NULL REFERENCES incidents(id) ON DELETE CASCADE,
  component_id TEXT NOT NULL REFERENCES components(id) ON DELETE CASCADE,
  PRIMARY KEY (incident_id, component_id)
);

CREATE TABLE incident_updates (
  id          TEXT PRIMARY KEY,
  incident_id TEXT NOT NULL REFERENCES incidents(id) ON DELETE CASCADE,
  status      TEXT NOT NULL,
  body        TEXT NOT NULL,
  created_at  TEXT NOT NULL
);
CREATE INDEX incident_updates_incident ON incident_updates (incident_id, created_at);

CREATE TABLE users (
  id         TEXT PRIMARY KEY,
  username   TEXT NOT NULL UNIQUE COLLATE NOCASE,
  pw_hash    TEXT NOT NULL,                    -- PBKDF2-SHA256, base64
  pw_salt    TEXT NOT NULL,                    -- base64, 16 bytes
  iterations INTEGER NOT NULL,
  created_at TEXT NOT NULL
);

-- Sessions by the SHA-256 of their cookie (the cookie itself is never stored).
CREATE TABLE sessions (
  token_hash TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);

-- Failed logins, for the limit per address (kept a day).
CREATE TABLE login_failures (
  ip TEXT NOT NULL,
  at TEXT NOT NULL
);
CREATE INDEX login_failures_ip ON login_failures (ip, at);

-- What admins changed, and when.
CREATE TABLE audit (
  at      TEXT NOT NULL,
  user_id TEXT,
  action  TEXT NOT NULL,
  detail  TEXT
);

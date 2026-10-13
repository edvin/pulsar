-- Pulsar as a product: branding, groups, uptime history, subscribers, templates, API keys, postmortems.

ALTER TABLE pages ADD COLUMN description TEXT;
ALTER TABLE pages ADD COLUMN accent TEXT NOT NULL DEFAULT '#7c5cff';      -- the brand colour (#rrggbb)
ALTER TABLE pages ADD COLUMN logo_text TEXT;                              -- a mark: one or two characters, or an emoji
ALTER TABLE pages ADD COLUMN website_url TEXT;
ALTER TABLE pages ADD COLUMN support_url TEXT;
ALTER TABLE pages ADD COLUMN hide_powered_by INTEGER NOT NULL DEFAULT 0;

ALTER TABLE components ADD COLUMN group_name TEXT;                        -- services under one heading
ALTER TABLE components ADD COLUMN show_uptime INTEGER NOT NULL DEFAULT 1;

ALTER TABLE incidents ADD COLUMN postmortem TEXT;                          -- markdown, after it's resolved
ALTER TABLE incidents ADD COLUMN auto_transition INTEGER NOT NULL DEFAULT 1; -- maintenance starts and completes on its own

-- Every status a service has had, from when: the uptime bars and percentages.
CREATE TABLE component_status_log (
  component_id TEXT NOT NULL REFERENCES components(id) ON DELETE CASCADE,
  status       TEXT NOT NULL,
  at           TEXT NOT NULL
);
CREATE INDEX component_status_log_c ON component_status_log (component_id, at);
INSERT INTO component_status_log (component_id, status, at) SELECT id, status, created_at FROM components;

-- Who hears about changes: a webhook (JSON, signed), or a Slack/Teams-style incoming webhook (text).
CREATE TABLE subscribers (
  id         TEXT PRIMARY KEY,
  page_id    TEXT NOT NULL REFERENCES pages(id) ON DELETE CASCADE,
  kind       TEXT NOT NULL CHECK (kind IN ('webhook', 'slack')),
  target     TEXT NOT NULL,                    -- the https URL
  secret     TEXT NOT NULL,                    -- signs webhook bodies (X-Pulsar-Signature), and unsubscribes
  created_at TEXT NOT NULL,
  last_status INTEGER,                         -- the last delivery's HTTP status (0: no answer)
  last_at    TEXT,
  failures   INTEGER NOT NULL DEFAULT 0,       -- in a row; at 20 the subscriber is switched off
  active     INTEGER NOT NULL DEFAULT 1,
  UNIQUE (page_id, target)
);

-- Ready-made incidents for a page.
CREATE TABLE templates (
  id         TEXT PRIMARY KEY,
  page_id    TEXT NOT NULL REFERENCES pages(id) ON DELETE CASCADE,
  name       TEXT NOT NULL,
  title      TEXT NOT NULL,
  body       TEXT NOT NULL,
  impact     TEXT NOT NULL DEFAULT 'minor',
  created_at TEXT NOT NULL
);

-- Keys for the write API (Bearer), by their SHA-256; for one page or all.
CREATE TABLE api_keys (
  id         TEXT PRIMARY KEY,
  page_id    TEXT REFERENCES pages(id) ON DELETE CASCADE,
  name       TEXT NOT NULL,
  key_hash   TEXT NOT NULL UNIQUE,
  prefix     TEXT NOT NULL,                    -- the first characters, to recognise it
  created_by TEXT,
  created_at TEXT NOT NULL,
  last_used  TEXT
);

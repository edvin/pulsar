-- A page at a hostname of its own (status.example.com): served at "/" there, as well as at /p/<slug>.
ALTER TABLE pages ADD COLUMN hostname TEXT;
CREATE UNIQUE INDEX pages_hostname ON pages (hostname) WHERE hostname IS NOT NULL;

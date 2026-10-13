#!/usr/bin/env node
/**
 * A demo page to look at: "Acme Cloud" at /p/acme, with grouped services, 90 days of history (a few
 * bad days), a resolved incident with a postmortem, an open one, and maintenance coming up.
 *   npm run demo            (the local D1; --remote for the deployed one)
 * Run it again to start the page over.
 */
import { execFileSync } from 'node:child_process';
import { writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const REMOTE = process.argv.includes('--remote');
const DAY = 86_400_000;
const now = Date.now();
const iso = (t) => new Date(t).toISOString();
let n = 0;
const id = (p) => `${p}${String(++n).padStart(12 - p.length, '0')}`.slice(0, 12);
const q = (v) => (v === null || v === undefined ? 'NULL' : typeof v === 'number' ? String(v) : `'${String(v).replace(/'/g, "''")}'`);
const sql = [];
const insert = (table, row) => sql.push(`INSERT INTO ${table} (${Object.keys(row).join(', ')}) VALUES (${Object.values(row).map(q).join(', ')});`);

const page = 'demoacme0001';
const created = iso(now - 95 * DAY);
sql.push(`DELETE FROM pages WHERE slug = 'acme';`);
insert('pages', { id: page, slug: 'acme', name: 'Acme Cloud', time_zone: 'Europe/Oslo', created_at: created, updated_at: iso(now),
  description: 'Live status of Acme Cloud hosting, email and APIs.', accent: '#7c5cff', logo_text: '☁️', website_url: 'https://example.com', support_url: 'https://example.com/support' });

const groups = {
  Hosting: ['Websites', 'Control panel', 'DNS'],
  Email: ['Webmail', 'SMTP', 'IMAP/POP3'],
  Platform: ['Public API', 'Billing', 'Backups'],
};
const comp = {};
let pos = 0;
for (const [group, names] of Object.entries(groups)) for (const name of names) {
  comp[name] = id('democ');
  insert('components', { id: comp[name], page_id: page, name, status: 'operational', position: pos++, created_at: created, updated_at: iso(now), group_name: group, show_uptime: 1 });
  insert('component_status_log', { component_id: comp[name], status: 'operational', at: created });
}

/** A spell in a status, `daysAgo` back, for `minutes`. */
const spell = (name, status, daysAgo, minutes) => {
  const from = now - daysAgo * DAY;
  insert('component_status_log', { component_id: comp[name], status, at: iso(from) });
  insert('component_status_log', { component_id: comp[name], status: 'operational', at: iso(from + minutes * 60_000) });
};
spell('Websites', 'partial_outage', 61, 95);
spell('DNS', 'major_outage', 47, 22);
spell('Webmail', 'degraded_performance', 33, 180);
spell('SMTP', 'partial_outage', 3, 140);
spell('IMAP/POP3', 'partial_outage', 3, 140);
spell('Billing', 'degraded_performance', 8, 60);
spell('Backups', 'under_maintenance', 20, 120);

function incident({ name, impact, kind = 'incident', components, updates, postmortem = null, scheduled = null }) {
  const i = id('demoi');
  const first = updates[0].at; const last = updates.at(-1);
  const resolved = ['resolved', 'completed', 'postmortem'].includes(last.status) ? last.at : null;
  insert('incidents', { id: i, page_id: page, kind, name, status: last.status, impact, created_at: iso(first), updated_at: iso(last.at), started_at: iso(first),
    monitoring_at: updates.find((u) => u.status === 'monitoring') ? iso(updates.find((u) => u.status === 'monitoring').at) : null,
    resolved_at: resolved ? iso(resolved) : null, scheduled_for: scheduled?.[0] ? iso(scheduled[0]) : null, scheduled_until: scheduled?.[1] ? iso(scheduled[1]) : null, postmortem, auto_transition: 1 });
  for (const c of components) insert('incident_components', { incident_id: i, component_id: comp[c] });
  for (const u of updates) insert('incident_updates', { id: id('demou'), incident_id: i, status: u.status, body: u.body, created_at: iso(u.at) });
}

const tMail = now - 3 * DAY;
incident({
  name: 'Delayed email delivery', impact: 'major', components: ['SMTP', 'IMAP/POP3'],
  updates: [
    { status: 'investigating', at: tMail, body: 'Some incoming and outgoing email is delayed. We are looking into it.' },
    { status: 'identified', at: tMail + 35 * 60_000, body: 'A storage node behind the mail queue is overloaded. We are moving traffic off it.' },
    { status: 'monitoring', at: tMail + 110 * 60_000, body: 'The queue is draining and new mail is delivered on time. Delayed messages arrive within the hour.' },
    { status: 'resolved', at: tMail + 140 * 60_000, body: 'All delayed email has been delivered. Nothing was lost.' },
  ],
  postmortem: '## What happened\n\nA storage node behind the mail queue ran out of I/O headroom after a disk failed, so delivery slowed down for **2 h 20 min**.\n\n## What we are changing\n\n- Alerts on queue age, not only on queue size\n- A spare node kept warm, so traffic moves in minutes',
});
const t47 = now - 47 * DAY;
incident({
  name: 'DNS lookups failing', impact: 'critical', components: ['DNS'],
  updates: [
    { status: 'investigating', at: t47, body: 'Some domains do not resolve. We are investigating.' },
    { status: 'resolved', at: t47 + 22 * 60_000, body: 'A bad configuration push was rolled back. All domains resolve again.' },
  ],
});
const open = now - 40 * 60_000;
sql.push(`UPDATE components SET status = 'degraded_performance' WHERE id = ${q(comp['Control panel'])};`);
insert('component_status_log', { component_id: comp['Control panel'], status: 'degraded_performance', at: iso(open) });
incident({
  name: 'Control panel is slow to load', impact: 'minor', components: ['Control panel'],
  updates: [
    { status: 'investigating', at: open, body: 'Some pages in the control panel take longer than usual to load. Your sites and email are not affected.' },
    { status: 'identified', at: open + 25 * 60_000, body: 'A slow database query is the cause. A fix is being deployed.' },
  ],
});
const m = now + 3 * DAY;
incident({
  name: 'Backup storage upgrade', impact: 'maintenance', kind: 'maintenance', components: ['Backups'], scheduled: [m, m + 2 * 3_600_000],
  updates: [{ status: 'scheduled', at: now - 2 * DAY, body: 'We are moving backups to faster storage. New backups may start later than usual during the window; existing backups stay available.' }],
});

const dir = mkdtempSync(join(tmpdir(), 'pulsar-demo-'));
const file = join(dir, 'demo.sql');
writeFileSync(file, sql.join('\n'));
try {
  execFileSync('npx', ['wrangler', 'd1', 'execute', 'pulsar', REMOTE ? '--remote' : '--local', '--file', file], { stdio: 'inherit' });
  console.log(`\nDemo page ready: /p/acme`);
} finally { rmSync(dir, { recursive: true, force: true }); }

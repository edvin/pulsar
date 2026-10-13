#!/usr/bin/env node
/**
 * End-to-end against a running Pulsar (default: wrangler dev --local-protocol https on 8787).
 *   node test/e2e.mjs [base] [--local]   (--local: makes its test admin in the local D1)
 * Signs in, makes a page with services, opens an incident, updates and resolves it, and checks the
 * v2 JSON at each step; then the guards (cross-site posts, wrong passwords, the login limit).
 */
import { webcrypto as crypto } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import assert from 'node:assert/strict';

process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0'; // wrangler dev's own certificate
const BASE = process.argv.find((a) => a.startsWith('http')) ?? 'https://127.0.0.1:8787';
const LOCAL = process.argv.includes('--local');
const USER = `e2e${Date.now()}`;
const PASS = `pw-${crypto.randomUUID()}`;

async function makeAdmin() {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(PASS), 'PBKDF2', false, ['deriveBits']);
  const hash = Buffer.from(await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: 25000 }, key, 256)).toString('base64');
  const sql = `INSERT INTO users (id, username, pw_hash, pw_salt, iterations, created_at) VALUES ('${USER.slice(-12).padStart(12, 'e')}', '${USER}', '${hash}', '${Buffer.from(salt).toString('base64')}', 25000, '${new Date().toISOString()}')`;
  execFileSync('npx', ['wrangler', 'd1', 'execute', 'pulsar', LOCAL ? '--local' : '--remote', '--command', sql], { stdio: 'ignore' });
}
async function dropAdmin() {
  execFileSync('npx', ['wrangler', 'd1', 'execute', 'pulsar', LOCAL ? '--local' : '--remote', '--command',
    `DELETE FROM pages WHERE slug LIKE 'e2e-%'; DELETE FROM audit WHERE detail LIKE '%e2e-%' OR user_id IN (SELECT id FROM users WHERE username LIKE 'e2e%') OR user_id = 'api:e2e'; DELETE FROM users WHERE username LIKE 'e2e%'; DELETE FROM login_failures WHERE ip LIKE 'pw:%'`], { stdio: 'ignore' });
}

let cookie = '';
const post = (path, form, headers = { origin: BASE }) => fetch(BASE + path, { method: 'POST', redirect: 'manual', headers: { 'content-type': 'application/x-www-form-urlencoded', cookie, ...headers }, body: new URLSearchParams(form) });
const get = (path) => fetch(BASE + path, { redirect: 'manual', headers: { cookie } });
const json = async (path) => (await fetch(BASE + path)).json();
const step = (s) => console.log(`✓ ${s}`);

await makeAdmin();
try {
  // Signed out: the admin is behind the login; a wrong password is refused.
  assert.equal((await get('/admin')).headers.get('location'), '/admin/login');
  assert.equal((await post('/admin/login', { username: USER, password: 'nope-nope-nope' })).status, 401);
  // A cross-site login post is refused before anything else.
  assert.equal((await post('/admin/login', { username: USER, password: PASS }, { origin: 'https://evil.example' })).status, 403);
  step('signed out: login required; wrong password and cross-site posts refused');

  const r = await post('/admin/login', { username: USER, password: PASS });
  assert.equal(r.status, 303);
  const set = r.headers.get('set-cookie');
  assert.match(set, /HttpOnly/); assert.match(set, /Secure/); assert.match(set, /SameSite=Strict/);
  cookie = set.split(';')[0];
  step('signed in: HttpOnly, Secure, SameSite=Strict session');

  const slug = `e2e-${Date.now().toString(36)}`;
  assert.equal((await post('/admin', { name: 'E2E Uniweb', slug, time_zone: 'Europe/Oslo' })).status, 303);
  assert.equal((await post('/admin', { name: 'Again', slug, time_zone: 'Europe/Oslo' })).headers.get('location').includes('err='), true);
  assert.equal((await post(`/admin/p/${slug}/services`, { names: 'E-mail\nWebsites\nControl panel' })).status, 303);
  let s = await json(`/p/${slug}/api/v2/summary.json`);
  assert.equal(s.status.indicator, 'none'); assert.equal(s.components.length, 3); assert.deepEqual(s.incidents, []);
  step('a page with three services; summary.json all operational');

  // An incident on E-mail.
  const mail = s.components.find((c) => c.name === 'E-mail');
  const opened = await post(`/admin/p/${slug}/incidents`, { kind: 'incident', name: 'E-post er nede', status: 'investigating', impact: 'major', body: 'Vi undersøker problemer med e-post.', component: mail.id, [`cstatus_${mail.id}`]: 'major_outage' });
  assert.equal(opened.status, 303);
  const incId = /incidents\/([a-z0-9]{12})/.exec(opened.headers.get('location'))[1];
  s = await json(`/p/${slug}/api/v2/summary.json`);
  assert.equal(s.status.indicator, 'critical'); // a component in major outage outranks the incident's "major"
  assert.equal(s.incidents.length, 1);
  assert.equal(s.incidents[0].id, incId); assert.match(incId, /^[a-z0-9]{12}$/);
  assert.equal(s.incidents[0].components[0].name, 'E-mail');
  assert.equal(s.incidents[0].incident_updates[0].body, 'Vi undersøker problemer med e-post.');
  assert.equal(s.components.find((c) => c.name === 'E-mail').status, 'major_outage');
  let list = await json(`/p/${slug}/api/v2/incidents.json`);
  assert.equal(list.incidents[0].status, 'investigating'); assert.equal(list.incidents[0].resolved_at, null);
  assert.match(list.incidents[0].shortlink, new RegExp(`/p/${slug}/incidents/${incId}$`));
  step('incident opened: in summary.json and incidents.json, E-mail in major outage');

  // Identified, then resolved.
  assert.equal((await post(`/admin/p/${slug}/incidents/${incId}`, { status: 'identified', impact: 'major', body: 'Feilen er funnet.', component: mail.id, [`cstatus_${mail.id}`]: 'partial_outage' })).status, 303);
  s = await json(`/p/${slug}/api/v2/summary.json`);
  assert.equal(s.incidents[0].status, 'identified'); assert.equal(s.incidents[0].incident_updates.length, 2);
  assert.equal(s.incidents[0].incident_updates[0].status, 'identified'); // newest first
  assert.equal(s.status.indicator, 'major');
  assert.equal((await post(`/admin/p/${slug}/incidents/${incId}`, { status: 'resolved', impact: 'major', body: 'Feilen er rettet, og e-post fungerer som normalt igjen.', component: mail.id })).status, 303);
  s = await json(`/p/${slug}/api/v2/summary.json`);
  assert.equal(s.status.indicator, 'none'); assert.deepEqual(s.incidents, []);
  assert.equal(s.components.find((c) => c.name === 'E-mail').status, 'operational');
  list = await json(`/p/${slug}/api/v2/incidents.json`);
  assert.equal(list.incidents[0].status, 'resolved'); assert.ok(list.incidents[0].resolved_at);
  assert.equal(list.incidents[0].incident_updates[0].body, 'Feilen er rettet, og e-post fungerer som normalt igjen.');
  step('identified, then resolved: summary empty, incidents.json resolved with resolved_at, E-mail operational');

  // Maintenance: scheduled leaves services alone; in progress marks them.
  const web = s.components.find((c) => c.name === 'Websites');
  const m = await post(`/admin/p/${slug}/incidents`, { kind: 'maintenance', name: 'Planlagt vedlikehold', status: 'scheduled', body: 'Vi oppgraderer webserverne.', scheduled_for: '2030-01-01T22:00', scheduled_until: '2030-01-02T02:00', component: web.id, [`cstatus_${web.id}`]: 'under_maintenance' });
  assert.equal(m.status, 303);
  s = await json(`/p/${slug}/api/v2/summary.json`);
  assert.equal(s.scheduled_maintenances.length, 1);
  assert.equal(s.scheduled_maintenances[0].scheduled_for, '2030-01-01T21:00:00.000Z'); // Oslo is UTC+1 in January
  assert.equal(s.components.find((c) => c.name === 'Websites').status, 'operational');
  step('maintenance scheduled in the page\'s time zone; services untouched until it starts');

  // Public pages and escaping.
  const evil = await post(`/admin/p/${slug}/incidents`, { kind: 'incident', name: '<script>alert(1)</script>', status: 'investigating', impact: 'minor', body: '<img src=x onerror=alert(1)>' });
  const evilId = /incidents\/([a-z0-9]{12})/.exec(evil.headers.get('location'))[1];
  const page = await (await get(`/p/${slug}`)).text();
  assert.ok(!page.includes('<script>alert(1)</script>') && page.includes('&lt;script&gt;'));
  assert.ok(!page.includes('<img src=x'));
  const pub = await get(`/p/${slug}`);
  assert.match(pub.headers.get('content-security-policy'), /default-src 'none'/);
  assert.equal((await get(`/p/${slug}/incidents/${evilId}`)).status, 200);
  step('public page and incident page render, with everything escaped and a strict CSP');

  // Guards once signed in: cross-site posts, unknown pages, unsigned access.
  assert.equal((await post(`/admin/p/${slug}/incidents/${evilId}/delete`, {}, { origin: 'https://evil.example' })).status, 403);
  assert.equal((await post(`/admin/p/${slug}/incidents/${evilId}/delete`, {}, {})).status, 403); // no Origin, no Sec-Fetch-Site
  assert.equal((await post(`/admin/p/${slug}/incidents/${evilId}/delete`, {})).status, 303);
  assert.equal((await json(`/p/${slug}/api/v2/incidents.json`)).incidents.some((i) => i.id === evilId), false);
  assert.equal((await fetch(`${BASE}/p/nope-nope/api/v2/summary.json`)).status, 404);
  const anon = await fetch(`${BASE}/admin/p/${slug}`, { redirect: 'manual' });
  assert.equal(anon.headers.get('location'), `/admin/login?next=${encodeURIComponent(`/admin/p/${slug}`)}`); // back to where they were, after signing in
  step('signed in: cross-site and origin-less posts refused; deletes work; unknown pages 404; signed out sees nothing');

  // The product bits: uptime bars, history, feeds, the badge, the markdown preview, templates, a postmortem.
  const pageHtml = await (await get(`/p/${slug}`)).text();
  assert.equal((pageHtml.match(/class="bar /g) ?? []).length, 3 * 90);
  assert.match(pageHtml, /% uptime/);
  assert.equal((await get(`/p/${slug}/history`)).status, 200);
  const rss = await (await get(`/p/${slug}/history.rss`)).text();
  assert.match(rss, /<rss version="2.0"/); assert.match(rss, /E-post er nede/);
  assert.match(await (await get(`/p/${slug}/history.atom`)).text(), /<feed xmlns="http:\/\/www.w3.org\/2005\/Atom">/);
  const badgeRes = await get(`/p/${slug}/badge.svg`);
  assert.equal(badgeRes.headers.get('content-type'), 'image/svg+xml; charset=utf-8'); assert.match(await badgeRes.text(), /operational/);
  assert.equal(await (await post('/admin/preview', { text: '**hi** <b>x</b>' })).text(), '<p><strong>hi</strong> &lt;b&gt;x&lt;/b&gt;</p>');
  assert.equal((await post(`/admin/p/${slug}/templates`, { name: 'Mail', title: 'E-post er treg', body: 'Vi ser forsinkelser.', impact: 'minor' })).status, 303);
  assert.match(await (await get(`/admin/p/${slug}/incidents/new`)).text(), /data-title="E-post er treg"/);
  assert.equal((await post(`/admin/p/${slug}/incidents/${incId}/postmortem`, { postmortem: 'A disk filled up. **We added alerts.**' })).status, 303);
  assert.match(await (await get(`/p/${slug}/incidents/${incId}`)).text(), /<strong>We added alerts.<\/strong>/);
  assert.equal((await json(`/p/${slug}/api/v2/incidents.json`)).incidents.find((i) => i.id === incId).status, 'postmortem');
  for (const p of ['', '/incidents', '/services', '/subscribers', '/templates', '/settings']) assert.equal((await get(`/admin/p/${slug}${p}`)).status, 200, `admin page ${p}`);
  for (const p of ['/admin', '/admin/keys', '/admin/users', '/admin/audit', '/admin/new-page']) assert.equal((await get(p)).status, 200, p);
  step('uptime bars, history, RSS/Atom, badge, safe markdown preview, templates, postmortem, every admin screen');

  // The write API: a key for this page opens, updates and resolves an incident, and sets a service.
  const keyPage = await (await post('/admin/keys', { name: 'e2e', page: slug })).text();
  const key = /data-copy="(pls_[A-Za-z0-9]+)"/.exec(keyPage)[1];
  const api = (method, path, body, k = key) => fetch(`${BASE}/api/v1/pages/${slug}${path}`, { method, headers: { authorization: `Bearer ${k}`, 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  assert.equal((await api('GET', '', null, 'pls_wrongwrongwrongwrongwrong')).status, 401);
  const info = await (await api('GET', '')).json();
  const ctl = info.components.find((c) => c.name === 'Control panel');
  const created = await api('POST', '/incidents', { name: 'API: kontrollpanel tregt', status: 'investigating', impact: 'minor', body: 'Fra overvåkingen.', components: { [ctl.id]: 'degraded_performance' } });
  assert.equal(created.status, 201);
  const apiInc = await created.json();
  assert.equal((await json(`/p/${slug}/api/v2/summary.json`)).components.find((c) => c.id === ctl.id).status, 'degraded_performance');
  assert.equal((await api('POST', `/incidents/${apiInc.id}/updates`, { status: 'nope', body: 'x' })).status, 422);
  assert.equal((await (await api('POST', `/incidents/${apiInc.id}/updates`, { status: 'resolved', body: 'Løst.' })).json()).status, 'resolved');
  assert.equal((await json(`/p/${slug}/api/v2/summary.json`)).components.find((c) => c.id === ctl.id).status, 'operational');
  assert.equal((await (await api('PATCH', `/components/${ctl.id}`, { status: 'partial_outage' })).json()).status, 'partial_outage');
  assert.equal((await api('GET', '', null)).status, 200);
  assert.equal((await fetch(`${BASE}/api/v1/pages/someone-elses-page`, { headers: { authorization: `Bearer ${key}` } })).status, 404); // a key for one page only
  assert.match(await (await get('/admin/audit')).text(), /API key e2e/);
  step('write API: page-scoped key opens, updates, resolves and sets a service; bad keys and statuses refused; audited');

  // Sign out: the session is gone.
  assert.equal((await post('/admin/logout', {})).status, 303);
  assert.equal((await get('/admin')).headers.get('location'), '/admin/login');
  step('signed out: the old cookie no longer works');

  // The login limit: ten wrong tries from one address, then refused even with the right password.
  const ip = `203.0.113.${Math.floor(Math.random() * 250)}`;
  for (let i = 0; i < 10; i++) await post('/admin/login', { username: USER, password: 'wrong-wrong-wrong' }, { origin: BASE, 'cf-connecting-ip': ip });
  const limited = await post('/admin/login', { username: USER, password: PASS }, { origin: BASE, 'cf-connecting-ip': ip });
  if (LOCAL) { assert.equal(limited.status, 429); step('ten wrong passwords: the address is limited, even with the right one'); }
  else console.log('· the login limit is checked locally only (Cloudflare sets the address itself)');
} finally {
  await dropAdmin();
}
console.log('all passed');

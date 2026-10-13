/**
 * The admin app (/admin): a dashboard, each page's incidents, services, subscribers, templates and
 * settings, API keys, admins and the audit log. Server-rendered forms (the script adds previews,
 * shortcuts and toasts); every change is a POST from this origin by a signed-in admin, audited.
 */
import { COMPONENT_STATUSES, IMPACTS, INCIDENT_STATUSES, MAINTENANCE_STATUSES, indicator, isOpen, type IncidentRow, type PageData } from './format.ts';
import { ago, document, duration, html, icon, LABEL, raw, when, type Html } from './html.ts';
import { b64, currentUser, login, logout, newPassword, passwordOk, PASSWORD_RULE, randomBytes, sha256, verify, type User } from './auth.ts';
import { audit, loadPage, newId, nowIso, pageBySlug, utcToZoned } from './db.ts';
import { Invalid, defaultComponentStatus, deleteIncident, notify, openIncident, postUpdate, setComponentStatus, setPostmortem } from './core.ts';
import { markdown } from './markdown.ts';
import { computeUptime, loadUptime } from './uptime.ts';

type Form = Map<string, string[]>;
type Ctx = { waitUntil(p: Promise<unknown>): void };
interface Env { DB: D1Database }
type App = (o: AppOpts) => Response;
const one = (f: Form, k: string) => (f.get(k)?.[0] ?? '').trim();
const all = (f: Form, k: string) => f.get(k) ?? [];

const redirect = (to: string, headers: Record<string, string> = {}) => new Response(null, { status: 303, headers: { location: to, ...headers } });
const flash = (to: string, msg: string, kind: 'ok' | 'err' = 'ok') => redirect(`${to}${to.includes('?') ? '&' : '?'}${kind}=${encodeURIComponent(msg)}`);
const options = (values: readonly string[], selected: string) => values.map((v) => html`<option value="${v}"${raw(v === selected ? ' selected' : '')}>${LABEL[v] ?? v}</option>`);
const ACCENT = /^#[0-9a-f]{6}$/i;
const accentOf = (a: string | undefined | null) => (a && ACCENT.test(a) ? a : '#7c5cff');
const httpsUrl = (u: string) => { try { const x = new URL(u); return x.protocol === 'https:' && x.hostname.includes('.'); } catch { return false; } };

// ---------------------------------------------------------------------------

export async function handleAdmin(req: Request, env: Env, url: URL, ctx: Ctx): Promise<Response> {
  const db = env.DB;
  const path = url.pathname.replace(/\/+$/, '') || '/admin';

  // Every change comes from a page of ours (with SameSite=Strict cookies, belt and braces).
  if (req.method === 'POST') {
    const origin = req.headers.get('origin'); const site = req.headers.get('sec-fetch-site');
    if (origin ? origin !== url.origin : site !== 'same-origin') return new Response('Cross-site request refused.', { status: 403 });
  }
  if (path === '/admin/login') {
    if (req.method === 'POST') {
      const f = await formOf(req);
      const r = await login(db, req.headers.get('cf-connecting-ip') ?? 'unknown', one(f, 'username'), f.get('password')?.[0] ?? '');
      if (!r.ok) return r.reason === 'limited' ? loginPage(url, 'Too many tries. Wait 15 minutes.', 429) : loginPage(url, 'Wrong username or password.', 401);
      const next = url.searchParams.get('next');
      return redirect(next && /^\/admin(\/[\w/-]*)?$/.test(next) ? next : '/admin', { 'set-cookie': r.setCookie });
    }
    return loginPage(url);
  }
  const user = await currentUser(db, req);
  if (!user) return redirect(`/admin/login${path !== '/admin' && req.method === 'GET' ? `?next=${encodeURIComponent(path)}` : ''}`);
  const nav = await navData(db);
  const app: App = (o) => shell(user, nav, url, o);

  if (path === '/admin/logout' && req.method === 'POST') return redirect('/admin/login', { 'set-cookie': await logout(db, req) });
  if (path === '/admin/preview' && req.method === 'POST') return new Response(markdown(one(await formOf(req), 'text')), { headers: { 'content-type': 'text/html; charset=utf-8' } });
  if (path === '/admin') return req.method === 'POST' ? createPage(db, user, await formOf(req)) : dashboard(db, app, nav);
  if (path === '/admin/new-page') return newPageView(app);
  if (path === '/admin/users') return req.method === 'POST' ? addUser(db, user, await formOf(req)) : usersView(db, user, app);
  if (path === '/admin/password' && req.method === 'POST') return changePassword(db, user, await formOf(req));
  if (path === '/admin/keys') return req.method === 'POST' ? createKey(db, user, nav, await formOf(req), app) : keysView(db, nav, app);
  if (path === '/admin/audit') return auditView(db, app, url);
  let m = /^\/admin\/users\/([a-z0-9]{12})\/delete$/.exec(path);
  if (m && req.method === 'POST') return deleteUser(db, user, m[1]!);
  m = /^\/admin\/keys\/([a-z0-9]{12})\/delete$/.exec(path);
  if (m && req.method === 'POST') { await db.prepare('DELETE FROM api_keys WHERE id = ?').bind(m[1]).run(); await audit(db, user.id, 'API key revoked', { id: m[1] }); return flash('/admin/keys', 'Key revoked.'); }

  m = /^\/admin\/p\/([a-z0-9-]{1,40})(\/.*)?$/.exec(path);
  if (!m) return new Response('Not found.', { status: 404 });
  const d = await loadPage(db, m[1]!);
  if (!d) return new Response('No such page.', { status: 404 });
  const rest = m[2] ?? ''; const base = `/admin/p/${d.page.slug}`;
  const post = req.method === 'POST';
  const f: Form = post ? await formOf(req) : new Map();
  try {
    if (rest === '') return overview(db, d, app, url);
    if (rest === '/settings') return post ? saveSettings(db, user, d, f) : settingsView(d, app);
    if (rest === '/delete' && post) return deletePage(db, user, d, f);
    if (rest === '/services') return post ? addService(db, user, d, f) : servicesView(d, app);
    let c = /^\/services\/([a-z0-9]{12})$/.exec(rest);
    if (c && post) return changeService(db, user, d, c[1]!, f);
    if (rest === '/incidents') {
      if (!post) return incidentsView(d, app, url);
      const id = await openIncident(db, d, user.id, composerInput(f, d));
      const fresh = await loadPage(db, d.page.slug);
      if (fresh) ctx.waitUntil(notify(db, fresh, id, one(f, 'kind') === 'maintenance' ? 'maintenance.scheduled' : 'incident.created', url.origin));
      return flash(`${base}/incidents/${id}`, one(f, 'kind') === 'maintenance' ? 'Maintenance scheduled.' : 'Incident published. It’s live on the page and in the API.');
    }
    if (rest === '/incidents/new') return composerView(db, d, app, url);
    c = /^\/incidents\/([a-z0-9]{12})$/.exec(rest);
    if (c) {
      if (!post) return incidentView(d, app, c[1]!) ?? new Response('No such incident.', { status: 404 });
      const i = await postUpdate(db, d, user.id, c[1]!, { status: one(f, 'status'), body: one(f, 'body'), impact: one(f, 'impact'), components: pickedServices(f, d), scheduled_for: one(f, 'scheduled_for') || null, scheduled_until: one(f, 'scheduled_until') || null, local: true });
      const fresh = await loadPage(db, d.page.slug);
      if (fresh) ctx.waitUntil(notify(db, fresh, i.id, isOpen(i) ? `${i.kind}.updated` : `${i.kind}.${i.kind === 'maintenance' ? 'completed' : 'resolved'}`, url.origin));
      return flash(`${base}/incidents/${c[1]}`, isOpen(i) ? 'Update published.' : i.kind === 'maintenance' ? 'Completed. Services are back to operational.' : 'Resolved. Services are back to operational.');
    }
    c = /^\/incidents\/([a-z0-9]{12})\/postmortem$/.exec(rest);
    if (c && post) { await setPostmortem(db, d, user.id, c[1]!, f.get('postmortem')?.[0] ?? ''); return flash(`${base}/incidents/${c[1]}`, 'Postmortem saved.'); }
    c = /^\/incidents\/([a-z0-9]{12})\/delete$/.exec(rest);
    if (c && post) { await deleteIncident(db, d, user.id, c[1]!); return flash(`${base}/incidents`, 'Deleted.'); }
    if (rest === '/subscribers') return post ? addSubscriber(db, user, d, f) : subscribersView(db, d, app);
    c = /^\/subscribers\/([a-z0-9]{12})\/(delete|test|enable)$/.exec(rest);
    if (c && post) return subscriberAction(db, user, d, c[1]!, c[2]!, url.origin);
    if (rest === '/templates') return post ? addTemplate(db, user, d, f) : templatesView(db, d, app);
    c = /^\/templates\/([a-z0-9]{12})\/delete$/.exec(rest);
    if (c && post) { await db.prepare('DELETE FROM templates WHERE id = ? AND page_id = ?').bind(c[1], d.page.id).run(); await audit(db, user.id, 'template deleted', { page: d.page.slug }); return flash(`${base}/templates`, 'Template deleted.'); }
  } catch (e) {
    if (e instanceof Invalid) {
      const ref = req.headers.get('referer');
      return flash(ref && ref.startsWith(`${url.origin}/admin`) ? new URL(ref).pathname + new URL(ref).search.replace(/[?&](ok|err)=[^&]*/g, '') : base, e.message, 'err');
    }
    throw e;
  }
  return redirect(base);
}

async function formOf(req: Request): Promise<Form> {
  const out: Form = new Map();
  // No body, or not a form: nothing in it (not a crash).
  const fd = await req.formData().catch(() => new FormData());
  fd.forEach((v, k) => { if (typeof v === 'string') out.set(k, [...(out.get(k) ?? []), v.slice(0, 20000)]); });
  return out;
}

// ---------- the shell ----------

interface NavPage { slug: string; name: string; accent: string; logo_text: string | null; open: number }
async function navData(db: D1Database): Promise<NavPage[]> {
  return (await db.prepare(`SELECT p.slug, p.name, p.accent, p.logo_text, (SELECT count(*) FROM incidents i WHERE i.page_id = p.id AND i.kind = 'incident' AND i.status NOT IN ('resolved', 'postmortem')) AS open
    FROM pages p ORDER BY p.name`).all<NavPage>()).results;
}
const miniMark = (p: { name: string; accent: string; logo_text: string | null }, size = 22) =>
  html`<span class="mark" style="width:${size}px;height:${size}px;border-radius:${Math.round(size / 3)}px;font-size:${Math.round(size / 2)}px;box-shadow:none;--accent:${accentOf(p.accent)}" aria-hidden="true">${p.logo_text || p.name.charAt(0).toUpperCase()}</span>`;

interface AppOpts { title: string; crumbs?: Array<[string, string?]>; body: Html; page?: PageData; tab?: string; actions?: Html }
function shell(user: User, nav: NavPage[], url: URL, o: AppOpts): Response {
  const on = (href: string) => (url.pathname === href || url.pathname.startsWith(`${href}/`) ? 'on' : '');
  const err = url.searchParams.get('err'); const msg = url.searchParams.get('ok') ?? err;
  const tabs = o.page ? (() => {
    const b = `/admin/p/${o.page!.page.slug}`;
    const t = (k: string, label: string, href: string) => html`<a class="${o.tab === k ? 'on' : ''}" href="${href}"${raw(o.tab === k ? ' aria-current="page"' : '')}>${label}</a>`;
    return html`<nav class="tabs" aria-label="Page sections">${t('overview', 'Overview', b)}${t('incidents', 'Incidents', `${b}/incidents`)}${t('services', 'Services', `${b}/services`)}${t('subscribers', 'Subscribers', `${b}/subscribers`)}${t('templates', 'Templates', `${b}/templates`)}${t('settings', 'Settings', `${b}/settings`)}</nav>`;
  })() : '';
  return document({
    title: `${o.title} · Pulsar`, accent: o.page?.page.accent,
    body: html`<div class="app">
      <aside class="side" aria-label="Navigation">
        <a class="logo" href="/admin"><span class="mark" aria-hidden="true">${icon('page')}</span>Pulsar</a>
        <nav class="nav"><a class="${url.pathname === '/admin' ? 'on' : ''}" href="/admin">${icon('home')}Dashboard</a></nav>
        <div class="nav-h">Status pages</div>
        <nav class="nav">${nav.map((p) => html`<a class="${on(`/admin/p/${p.slug}`)}" href="/admin/p/${p.slug}">${miniMark(p)}${p.name}${p.open ? html`<span class="count" aria-label="${p.open} open">${p.open}</span>` : ''}</a>`)}
          <a href="/admin/new-page" class="${on('/admin/new-page')}">${icon('plus')}New page</a></nav>
        <div class="nav-h">Workspace</div>
        <nav class="nav"><a class="${on('/admin/keys')}" href="/admin/keys">${icon('key')}API keys</a><a class="${on('/admin/users')}" href="/admin/users">${icon('users')}Admins</a><a class="${on('/admin/audit')}" href="/admin/audit">${icon('log')}Audit log</a></nav>
        <div class="me"><span class="row"><span class="avatar" aria-hidden="true">${user.username.charAt(0).toUpperCase()}</span><span class="small">${user.username}</span></span>
          <span class="row"><button class="theme-toggle" style="width:32px;height:32px" type="button" data-theme-toggle aria-label="Switch light and dark">${icon('sun')}</button>
          <form method="post" action="/admin/logout"><button class="btn ghost sm" type="submit">Sign out</button></form></span></div>
      </aside>
      <div class="main">
        <div class="topbar"><div class="row"><button class="theme-toggle burger" type="button" data-nav-toggle aria-label="Menu">${icon('menu')}</button>
          <nav class="crumbs" aria-label="Breadcrumbs">${(o.crumbs ?? [[o.title]]).map(([label, href], i) => html`${i ? html`<span class="faint">/</span>` : ''}${href ? html`<a href="${href}">${label}</a>` : html`<b>${label}</b>`}`)}</nav></div>
          <div class="row">${o.actions ?? ''}</div></div>
        <main class="content">${tabs}${o.body}</main>
      </div></div>
      ${msg ? html`<div class="flash ${err ? 'err' : 'ok'}" role="${err ? 'alert' : 'status'}">${msg}<button class="x" type="button" aria-label="Dismiss">×</button></div>` : ''}`,
  });
}

function loginPage(url: URL, error?: string, status = 200): Response {
  const ok = url.searchParams.get('ok'); const next = url.searchParams.get('next');
  return document({
    title: 'Sign in · Pulsar', bodyClass: 'glow', status,
    body: html`<main class="login"><div class="card">
      <span class="mark" aria-hidden="true">${icon('page')}</span><h1>Welcome back</h1><p class="muted" style="margin:0 0 20px">Sign in to manage your status pages.</p>
      ${ok ? html`<div class="flash ok" role="status" style="position:static;margin-bottom:14px">${ok}</div>` : ''}${error ? html`<div class="flash err" role="alert" style="position:static;margin-bottom:14px">${error}</div>` : ''}
      <form class="grid" method="post" action="/admin/login${next ? `?next=${encodeURIComponent(next)}` : ''}">
        <label class="f">Username<input name="username" autocomplete="username" required maxlength="80" autofocus></label>
        <label class="f">Password<input name="password" type="password" autocomplete="current-password" required maxlength="200"></label>
        <button class="btn" type="submit" style="justify-content:center;margin-top:6px">Sign in</button>
      </form></div></main>`,
  });
}

// ---------- dashboard ----------

async function dashboard(db: D1Database, app: App, nav: NavPage[]): Promise<Response> {
  const open = (await db.prepare(`SELECT i.id, i.name, i.impact, i.status, i.kind, i.started_at, i.scheduled_for, p.slug, p.name AS page FROM incidents i JOIN pages p ON p.id = i.page_id
    WHERE (i.kind = 'incident' AND i.status NOT IN ('resolved', 'postmortem')) OR (i.kind = 'maintenance' AND i.status <> 'completed') ORDER BY i.started_at DESC LIMIT 50`).all<IncidentRow & { slug: string; page: string }>()).results;
  const counts = await db.prepare(`SELECT (SELECT count(*) FROM incidents WHERE kind = 'incident' AND created_at > ?) AS month, (SELECT count(*) FROM subscribers WHERE active = 1) AS subs, (SELECT count(*) FROM components) AS svcs`)
    .bind(new Date(Date.now() - 30 * 86_400_000).toISOString()).first<{ month: number; subs: number; svcs: number }>();
  const log = (await db.prepare(`SELECT a.at, a.action, a.detail, coalesce(u.username, CASE WHEN a.user_id LIKE 'api:%' THEN 'API key ' || substr(a.user_id, 5) END) AS username FROM audit a LEFT JOIN users u ON u.id = a.user_id ORDER BY a.at DESC LIMIT 8`).all<{ at: string; action: string; detail: string; username: string | null }>()).results;
  const incidents = open.filter((i) => i.kind === 'incident');
  return app({
    title: 'Dashboard', actions: nav[0] ? html`<a class="btn sm" data-key="n" href="/admin/p/${nav[0].slug}/incidents/new">${icon('plus')}New incident <span class="kbd" style="color:#fff;border-color:rgba(255,255,255,.4)">N</span></a>` : undefined,
    body: html`<div class="page-title"><div><h1>Dashboard</h1><p>${incidents.length ? `${incidents.length} incident${incidents.length > 1 ? 's' : ''} open right now.` : 'Everything is calm. All systems operational.'}</p></div></div>
      <div class="stats">
        <div class="card stat"><div class="k">Open incidents</div><div class="v" style="color:${incidents.length ? 'var(--major)' : 'var(--ok)'}">${incidents.length}</div></div>
        <div class="card stat"><div class="k">Incidents · 30 days</div><div class="v">${counts?.month ?? 0}</div></div>
        <div class="card stat"><div class="k">Status pages</div><div class="v">${nav.length}<small>${counts?.svcs ?? 0} services</small></div></div>
        <div class="card stat"><div class="k">Subscribers</div><div class="v">${counts?.subs ?? 0}</div></div>
      </div>
      <div class="split">
        <section class="card panel"><h2>Happening now</h2>${open.length ? open.map((i) => html`<div class="list-row"><div><a style="font-weight:650;color:var(--text)" href="/admin/p/${i.slug}/incidents/${i.id}">${i.name}</a>
          <div class="small muted">${i.page} · ${i.kind === 'maintenance' ? (i.status === 'scheduled' ? html`maintenance ${when(i.scheduled_for, 'Europe/Oslo', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}` : 'maintenance under way') : `for ${duration(i.started_at, null)}`}</div></div><span class="pill s-${i.status}">${LABEL[i.status]}</span></div>`)
          : html`<p class="empty">No open incidents or maintenance.</p>`}</section>
        <section class="card panel"><h2>Recent activity <a class="small" href="/admin/audit">All</a></h2>${log.length ? log.map((a) => html`<div class="list-row"><div class="small"><b>${a.username ?? 'Pulsar'}</b> ${a.action}<div class="faint tiny">${auditDetail(a.detail)}</div></div><span class="tiny faint">${ago(a.at, 'Europe/Oslo')}</span></div>`) : html`<p class="empty">Nothing yet.</p>`}</section>
      </div>
      <section class="card panel"><h2>Status pages <a class="btn ghost sm" href="/admin/new-page">${icon('plus')}New page</a></h2>
        ${nav.length ? html`<div class="grid g3">${nav.map((p) => html`<a class="opt" href="/admin/p/${p.slug}">${miniMark(p, 34)}
          <div><b>${p.name}</b><span>${p.open ? `${p.open} open` : 'All good'} · /p/${p.slug}</span></div></a>`)}</div>` : html`<p class="empty">No pages yet. <a href="/admin/new-page">Create your first page</a>.</p>`}
      </section>`,
  });
}
const auditDetail = (d: string) => { try { const o = JSON.parse(d) as Record<string, unknown>; return Object.entries(o).filter(([k]) => k !== 'id').map(([k, v]) => `${k}: ${String(v)}`).join(' · ').slice(0, 120); } catch { return ''; } };

// ---------- pages ----------

function newPageView(app: App): Response {
  return app({ title: 'New page', crumbs: [['Dashboard', '/admin'], ['New page']], body: html`<div class="page-title"><div><h1>New status page</h1><p>A page for a brand or product, with its own address, look and services.</p></div></div>
    <form class="card panel grid" method="post" action="/admin"><div class="grid g2">
      <label class="f">Name<input name="name" required maxlength="80" placeholder="Acme Cloud"></label>
      <label class="f">Address<input name="slug" required maxlength="40" pattern="[a-z0-9-]+" placeholder="acme"><span class="hint">/p/<b>address</b> · lowercase, digits, dashes</span></label>
      <label class="f">Brand colour<input name="accent" type="color" value="#7c5cff"></label>
      <label class="f">Time zone<input name="time_zone" value="Europe/Oslo" maxlength="60"></label></div>
      <label class="f">Services <span class="hint">One per line; "Group / Service" puts it under a heading. You can change them later.</span><textarea name="services" placeholder="Website&#10;E-mail / IMAP&#10;E-mail / SMTP&#10;Control panel"></textarea></label>
      <div class="row end"><button class="btn" type="submit">Create page</button></div></form>` });
}

const validZone = (tz: string) => { try { new Intl.DateTimeFormat('en', { timeZone: tz }); return true; } catch { return false; } };

function serviceStmts(db: D1Database, pageId: string, text: string, startPos: number, now: string): D1PreparedStatement[] {
  const stmts: D1PreparedStatement[] = []; let pos = startPos;
  for (const l of text.split('\n').map((x) => x.trim()).filter(Boolean).slice(0, 100)) {
    const slash = l.indexOf('/');
    const g = slash > 0 ? l.slice(0, slash).trim() : null; const n = slash > 0 ? l.slice(slash + 1).trim() : l;
    if (!n) continue;
    const id = newId();
    stmts.push(db.prepare('INSERT INTO components (id, page_id, name, group_name, status, position, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').bind(id, pageId, n.slice(0, 80), g?.slice(0, 80) || null, 'operational', ++pos, now, now));
    stmts.push(db.prepare('INSERT INTO component_status_log (component_id, status, at) VALUES (?, ?, ?)').bind(id, 'operational', now));
  }
  return stmts;
}

async function createPage(db: D1Database, user: User, f: Form): Promise<Response> {
  const name = one(f, 'name'); const slug = one(f, 'slug').toLowerCase(); const tz = one(f, 'time_zone') || 'Europe/Oslo'; const accent = one(f, 'accent') || '#7c5cff';
  if (!name || name.length > 80) return flash('/admin/new-page', 'Give the page a name.', 'err');
  if (!/^[a-z0-9-]{1,40}$/.test(slug)) return flash('/admin/new-page', 'The address: lowercase letters, digits and dashes.', 'err');
  if (!validZone(tz)) return flash('/admin/new-page', 'Not a time zone (like Europe/Oslo).', 'err');
  if (!ACCENT.test(accent)) return flash('/admin/new-page', 'A colour like #7c5cff.', 'err');
  if (await pageBySlug(db, slug)) return flash('/admin/new-page', 'That address is taken.', 'err');
  const now = nowIso(); const id = newId();
  await db.batch([db.prepare('INSERT INTO pages (id, slug, name, time_zone, accent, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)').bind(id, slug, name, tz, accent, now, now), ...serviceStmts(db, id, one(f, 'services'), 0, now)]);
  await audit(db, user.id, 'page created', { page: slug });
  return flash(`/admin/p/${slug}`, 'Page created. It’s live.');
}

async function overview(db: D1Database, d: PageData, app: App, url: URL): Promise<Response> {
  const base = `/admin/p/${d.page.slug}`;
  const s = indicator(d.components, d.incidents);
  const open = d.incidents.filter((i) => isOpen(i));
  const logs = await loadUptime(db, d.page.id, d.page.time_zone, 30);
  const ups = d.components.map((c) => computeUptime(logs.get(c.id) ?? [], c.created_at, d.page.time_zone, 30).percent);
  const avg = ups.length ? ups.reduce((a, b) => a + b, 0) / ups.length : 100;
  const subs = (await db.prepare('SELECT count(*) AS n FROM subscribers WHERE page_id = ? AND active = 1').bind(d.page.id).first<{ n: number }>())?.n ?? 0;
  const month = d.incidents.filter((i) => i.kind === 'incident' && Date.parse(i.created_at) > Date.now() - 30 * 86_400_000).length;
  const publicUrl = `${url.origin}/p/${d.page.slug}`;
  return app({
    title: d.page.name, page: d, tab: 'overview', crumbs: [['Dashboard', '/admin'], [d.page.name]],
    actions: html`<a class="btn ghost sm" href="/p/${d.page.slug}" target="_blank" rel="noopener">View page ${icon('ext')}</a><a class="btn sm" data-key="n" href="${base}/incidents/new">${icon('plus')}New incident</a>`,
    body: html`<section class="banner st-${s.indicator}" style="margin-top:0"><div class="sig" aria-hidden="true">${icon(s.indicator === 'none' ? 'check' : s.indicator === 'maintenance' ? 'wrench' : 'alert')}</div>
        <div><h2>${s.indicator === 'none' ? 'All systems operational' : s.description}</h2><p>What visitors see right now at <a href="/p/${d.page.slug}">${publicUrl}</a></p></div></section>
      <div class="stats" style="margin-top:18px">
        <div class="card stat"><div class="k">Uptime · 30 days</div><div class="v">${avg.toFixed(2)}<small>%</small></div></div>
        <div class="card stat"><div class="k">Open</div><div class="v">${open.length}</div></div>
        <div class="card stat"><div class="k">Incidents · 30 days</div><div class="v">${month}</div></div>
        <div class="card stat"><div class="k">Subscribers</div><div class="v">${subs}</div></div>
      </div>
      <div class="split">
        <section class="card panel"><h2>Open incidents & maintenance</h2>${open.length ? open.map((i) => incidentRow(d, i)) : html`<p class="empty">Nothing open. <a href="${base}/incidents/new">Report an incident</a> or <a href="${base}/incidents/new?kind=maintenance">schedule maintenance</a>.</p>`}</section>
        <section class="card panel"><h2>Quick status <a class="small" href="${base}/services">Manage</a></h2>
          ${d.components.length ? d.components.slice(0, 12).map((c) => html`<form class="list-row" method="post" action="${base}/services/${c.id}"><input type="hidden" name="action" value="status">
            <span class="small" style="font-weight:600">${c.name}</span><span class="row"><select name="status" aria-label="Status of ${c.name}" style="width:auto;padding:6px 10px;font-size:13px">${options(COMPONENT_STATUSES, c.status)}</select><button class="btn ghost sm" type="submit">Set</button></span></form>`)
            : html`<p class="empty">No services yet. <a href="${base}/services">Add some</a>.</p>`}
          ${d.components.length > 12 ? html`<p class="small"><a href="${base}/services">All ${d.components.length} services →</a></p>` : ''}
        </section>
      </div>
      <section class="card panel"><h2>Share & embed</h2><div class="grid g2">
        <div><div class="small muted" style="margin-bottom:4px">Public page</div><code class="copy" data-copy="${publicUrl}" title="Copy">${publicUrl}</code></div>
        <div><div class="small muted" style="margin-bottom:4px">API (v2 clients read /api/v2/summary.json)</div><code class="copy" data-copy="${publicUrl}" title="Copy">${publicUrl}/api/v2/summary.json</code></div>
        <div><div class="small muted" style="margin-bottom:4px">Badge</div><img src="/p/${d.page.slug}/badge.svg" alt="Status badge" style="vertical-align:middle"> <button class="btn ghost sm" type="button" data-copy="${`<img src="${publicUrl}/badge.svg" alt="${d.page.name} status">`}">Copy HTML</button></div>
        <div><div class="small muted" style="margin-bottom:4px">Feeds</div><a href="/p/${d.page.slug}/history.rss">RSS</a> · <a href="/p/${d.page.slug}/history.atom">Atom</a></div>
      </div></section>`,
  });
}

function incidentRow(d: PageData, i: IncidentRow): Html {
  return html`<div class="list-row"><div><a style="font-weight:650;color:var(--text)" href="/admin/p/${d.page.slug}/incidents/${i.id}">${i.name}</a>
    <div class="small muted">${i.kind === 'maintenance' ? `Maintenance · ${when(i.scheduled_for, d.page.time_zone)}` : `${LABEL[i.impact]} impact · ${isOpen(i) ? `for ${duration(i.started_at, null)}` : `lasted ${duration(i.started_at, i.resolved_at)}`}`}</div></div>
    <span class="pill s-${i.status}">${LABEL[i.status]}</span></div>`;
}

function settingsView(d: PageData, app: App): Response {
  const base = `/admin/p/${d.page.slug}`; const p = d.page;
  return app({
    title: 'Settings', page: d, tab: 'settings', crumbs: [['Dashboard', '/admin'], [p.name, base], ['Settings']],
    body: html`<form class="card panel grid" method="post" action="${base}/settings"><h2>Branding</h2><div class="grid g2">
        <label class="f">Name<input name="name" value="${p.name}" required maxlength="80"></label>
        <label class="f">Logo mark <span class="hint">One or two characters, or an emoji</span><input name="logo_text" value="${p.logo_text ?? ''}" maxlength="4" placeholder="${p.name.charAt(0)}"></label>
        <label class="f">Brand colour<input name="accent" type="color" value="${accentOf(p.accent)}"></label>
        <label class="f">Time zone<input name="time_zone" value="${p.time_zone}" maxlength="60"></label>
        <label class="f">Website<input name="website_url" type="url" value="${p.website_url ?? ''}" placeholder="https://"></label>
        <label class="f">Support<input name="support_url" value="${p.support_url ?? ''}" placeholder="https:// or mailto:"></label></div>
      <label class="f">Description <span class="hint">Under the title on the page</span><input name="description" value="${p.description ?? ''}" maxlength="240"></label>
      <label class="check"><input type="checkbox" name="hide_powered_by" value="1"${raw(p.hide_powered_by ? ' checked' : '')}> Hide “Powered by Pulsar”</label>
      <div class="row end"><button class="btn" type="submit">Save</button></div></form>
    <form class="card panel danger-zone grid" method="post" action="${base}/delete" data-confirm="Delete ${p.name} with all its incidents? This can’t be undone."><h2>Danger zone</h2>
      <p class="muted small" style="margin:0">Deleting the page removes its services, incidents, subscribers and history. Type <code>${p.slug}</code> to confirm.</p>
      <div class="row"><input name="confirm" aria-label="Type the address to confirm" style="max-width:260px" autocomplete="off"><button class="btn danger" type="submit">Delete page</button></div></form>`,
  });
}

async function saveSettings(db: D1Database, user: User, d: PageData, f: Form): Promise<Response> {
  const back = `/admin/p/${d.page.slug}/settings`;
  const name = one(f, 'name'); const tz = one(f, 'time_zone'); const accent = one(f, 'accent'); const web = one(f, 'website_url'); const sup = one(f, 'support_url');
  if (!name || name.length > 80) return flash(back, 'A name.', 'err');
  if (!validZone(tz)) return flash(back, 'Not a time zone (like Europe/Oslo).', 'err');
  if (!ACCENT.test(accent)) return flash(back, 'A colour like #7c5cff.', 'err');
  if (web && !httpsUrl(web)) return flash(back, 'The website: an https address.', 'err');
  if (sup && !httpsUrl(sup) && !/^mailto:[^\s@]+@[^\s@]+$/.test(sup)) return flash(back, 'Support: an https address or mailto:.', 'err');
  await db.prepare('UPDATE pages SET name = ?, time_zone = ?, accent = ?, logo_text = ?, description = ?, website_url = ?, support_url = ?, hide_powered_by = ?, updated_at = ? WHERE id = ?')
    .bind(name, tz, accent, one(f, 'logo_text').slice(0, 4) || null, one(f, 'description').slice(0, 240) || null, web || null, sup || null, one(f, 'hide_powered_by') ? 1 : 0, nowIso(), d.page.id).run();
  await audit(db, user.id, 'settings saved', { page: d.page.slug });
  return flash(back, 'Saved. The page shows it now.');
}

async function deletePage(db: D1Database, user: User, d: PageData, f: Form): Promise<Response> {
  if (one(f, 'confirm') !== d.page.slug) return flash(`/admin/p/${d.page.slug}/settings`, `Type ${d.page.slug} to delete the page.`, 'err');
  await db.prepare('DELETE FROM pages WHERE id = ?').bind(d.page.id).run();
  await audit(db, user.id, 'page deleted', { page: d.page.slug });
  return flash('/admin', `Deleted ${d.page.name}.`);
}

// ---------- services ----------

function servicesView(d: PageData, app: App): Response {
  const base = `/admin/p/${d.page.slug}`;
  const groups = [...new Set(d.components.map((c) => c.group_name).filter(Boolean))] as string[];
  return app({
    title: 'Services', page: d, tab: 'services', crumbs: [['Dashboard', '/admin'], [d.page.name, base], ['Services']],
    body: html`<section class="card panel"><h2>Services <span class="small muted">${d.components.length}</span></h2>
      ${d.components.length ? d.components.map((c) => html`<form class="svc-edit" method="post" action="${base}/services/${c.id}" style="display:grid;grid-template-columns:minmax(150px,2fr) minmax(120px,1.2fr) minmax(160px,1.4fr) 76px auto auto;gap:8px;align-items:center;padding:10px 0;border-bottom:1px solid var(--line)">
          <span><input name="name" value="${c.name}" aria-label="Name" maxlength="80"><input name="description" value="${c.description ?? ''}" aria-label="Description of ${c.name}" placeholder="Description (optional)" maxlength="200" style="margin-top:6px;font-size:12px;padding:6px 10px"></span>
          <input name="group_name" value="${c.group_name ?? ''}" aria-label="Group of ${c.name}" list="groups" placeholder="No group" maxlength="80">
          <select name="status" aria-label="Status of ${c.name}">${options(COMPONENT_STATUSES, c.status)}</select>
          <input name="position" type="number" value="${c.position}" aria-label="Order of ${c.name}">
          <label class="check small" title="Show the uptime bar"><input type="checkbox" name="show_uptime" value="1"${raw(c.show_uptime === 0 ? '' : ' checked')}> Uptime</label>
          <span class="row"><button class="btn ghost sm" name="action" value="save" type="submit">Save</button><button class="btn ghost sm" name="action" value="delete" type="submit" aria-label="Delete ${c.name}">✕</button></span>
        </form>`) : html`<p class="empty">No services yet.</p>`}
      <datalist id="groups">${groups.map((g) => html`<option value="${g}">`)}</datalist></section>
    <form class="card panel grid" method="post" action="${base}/services"><h2>Add services</h2>
      <label class="f">One per line <span class="hint">"Group / Service" puts it under a heading</span><textarea name="names" required placeholder="Web hosting / PHP&#10;Web hosting / MySQL"></textarea></label>
      <div class="row end"><button class="btn" type="submit">Add</button></div></form>`,
  });
}

async function addService(db: D1Database, user: User, d: PageData, f: Form): Promise<Response> {
  const back = `/admin/p/${d.page.slug}/services`;
  const stmts = serviceStmts(db, d.page.id, one(f, 'names'), d.components.reduce((m, c) => Math.max(m, c.position), 0), nowIso());
  if (!stmts.length) return flash(back, 'A name for the service.', 'err');
  await db.batch(stmts);
  const n = stmts.length / 2;
  await audit(db, user.id, 'services added', { page: d.page.slug, count: n });
  return flash(back, `Added ${n} service${n === 1 ? '' : 's'}.`);
}

async function changeService(db: D1Database, user: User, d: PageData, id: string, f: Form): Promise<Response> {
  const c = d.components.find((x) => x.id === id);
  const action = one(f, 'action');
  const back = `/admin/p/${d.page.slug}${action === 'status' ? '' : '/services'}`;
  if (!c) return flash(back, 'No such service.', 'err');
  if (action === 'delete') {
    await db.prepare('DELETE FROM components WHERE id = ?').bind(id).run();
    await audit(db, user.id, 'service deleted', { page: d.page.slug, name: c.name });
    return flash(back, `Deleted ${c.name}.`);
  }
  if (action === 'status') { await setComponentStatus(db, d, user.id, id, one(f, 'status')); return flash(back, `${c.name}: ${LABEL[one(f, 'status')]}.`); }
  const name = one(f, 'name'); const pos = Number.parseInt(one(f, 'position'), 10);
  if (!name || name.length > 80 || !Number.isFinite(pos)) return flash(back, 'A name and a number for the order.', 'err');
  await db.prepare('UPDATE components SET name = ?, description = ?, group_name = ?, position = ?, show_uptime = ?, updated_at = ? WHERE id = ?')
    .bind(name, one(f, 'description').slice(0, 200) || null, one(f, 'group_name').slice(0, 80) || null, pos, one(f, 'show_uptime') ? 1 : 0, nowIso(), id).run();
  if (one(f, 'status') && one(f, 'status') !== c.status) await setComponentStatus(db, d, user.id, id, one(f, 'status'));
  await audit(db, user.id, 'service changed', { page: d.page.slug, name });
  return flash(back, `Saved ${name}.`);
}

// ---------- incidents ----------

function incidentsView(d: PageData, app: App, url: URL): Response {
  const base = `/admin/p/${d.page.slug}`;
  const show = url.searchParams.get('show') ?? 'all';
  const list = d.incidents.filter((i) => show === 'open' ? isOpen(i) : show === 'maintenance' ? i.kind === 'maintenance' : show === 'resolved' ? !isOpen(i) : true);
  const f = (k: string, label: string) => html`<a class="btn ${show === k ? '' : 'ghost'} sm" href="${base}/incidents?show=${k}">${label}</a>`;
  return app({
    title: 'Incidents', page: d, tab: 'incidents', crumbs: [['Dashboard', '/admin'], [d.page.name, base], ['Incidents']],
    actions: html`<a class="btn ghost sm" href="${base}/incidents/new?kind=maintenance">${icon('wrench')}Schedule maintenance</a><a class="btn sm" data-key="n" href="${base}/incidents/new">${icon('plus')}New incident</a>`,
    body: html`<div class="row between" style="margin-bottom:14px"><div class="row">${f('all', 'All')}${f('open', 'Open')}${f('resolved', 'Resolved')}${f('maintenance', 'Maintenance')}</div>
      <input type="search" placeholder="Filter…  ( / )" data-filter="table.t tbody tr" style="max-width:260px" aria-label="Filter incidents"></div>
      <section class="card panel">${list.length ? html`<table class="t"><thead><tr><th>Incident</th><th>Status</th><th>Impact</th><th>Started</th><th>Duration</th></tr></thead><tbody>
        ${list.map((i) => html`<tr><td><a class="strong" href="${base}/incidents/${i.id}">${i.name}</a>${i.kind === 'maintenance' ? html` <span class="pill plain i-maintenance">Maintenance</span>` : ''}</td>
          <td><span class="pill s-${i.status}">${LABEL[i.status]}</span></td><td>${i.kind === 'incident' ? html`<span class="pill plain i-${i.impact}">${LABEL[i.impact]}</span>` : ''}</td>
          <td class="small">${when(i.started_at, d.page.time_zone, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</td>
          <td class="small muted">${i.kind === 'maintenance' && i.status === 'scheduled' ? '—' : isOpen(i) ? `${duration(i.started_at, null)} so far` : duration(i.started_at, i.resolved_at)}</td></tr>`)}
      </tbody></table>` : html`<p class="empty">Nothing here.</p>`}</section>`,
  });
}

function servicePicker(d: PageData, kind: string, impact: string, chosen: Map<string, string>): Html {
  if (!d.components.length) return html`<p class="empty small">This page has no services yet.</p>`;
  return html`<div class="svc-pick" data-svc-pick>${d.components.map((c) => html`<div class="row"><label class="check" title="${c.group_name ? `${c.group_name} / ${c.name}` : c.name}"><input type="checkbox" name="component" value="${c.id}"${raw(chosen.has(c.id) ? ' checked' : '')}> ${c.group_name ? html`<span class="faint">${c.group_name} /</span>` : ''} ${c.name}</label>
    <select name="cstatus_${c.id}" aria-label="Status of ${c.name}"${raw(chosen.has(c.id) ? ' data-touched="1"' : '')}>${options(COMPONENT_STATUSES, chosen.get(c.id) ?? defaultComponentStatus(kind, impact))}</select></div>`)}</div>`;
}

function pickedServices(f: Form, d: PageData): Record<string, string> {
  return Object.fromEntries(all(f, 'component').filter((c) => d.components.some((x) => x.id === c)).map((c) => [c, one(f, `cstatus_${c}`)]));
}
function composerInput(f: Form, d: PageData) {
  const kind = one(f, 'kind') === 'maintenance' ? 'maintenance' as const : 'incident' as const;
  return { kind, name: one(f, 'name'), status: one(f, 'status'), impact: one(f, 'impact'), body: one(f, 'body'), components: pickedServices(f, d),
    scheduled_for: one(f, 'scheduled_for') || null, scheduled_until: one(f, 'scheduled_until') || null, local: true, auto_transition: kind === 'incident' || one(f, 'auto_transition') === '1' };
}

async function composerView(db: D1Database, d: PageData, app: App, url: URL): Promise<Response> {
  const kind = url.searchParams.get('kind') === 'maintenance' ? 'maintenance' : 'incident';
  const base = `/admin/p/${d.page.slug}`;
  const templates = (await db.prepare('SELECT id, name, title, body, impact FROM templates WHERE page_id = ? ORDER BY name').bind(d.page.id).all<{ id: string; name: string; title: string; body: string; impact: string }>()).results;
  const statuses = kind === 'maintenance' ? MAINTENANCE_STATUSES.filter((s) => s !== 'completed') : INCIDENT_STATUSES.filter((s) => !['resolved', 'postmortem'].includes(s));
  const title = kind === 'maintenance' ? 'Schedule maintenance' : 'New incident';
  return app({
    title, page: d, tab: 'incidents', crumbs: [['Dashboard', '/admin'], [d.page.name, base], ['Incidents', `${base}/incidents`], [title]],
    body: html`<form method="post" action="${base}/incidents" class="split"><input type="hidden" name="kind" value="${kind}">
      <section class="card panel grid"><h2>${kind === 'maintenance' ? 'Schedule maintenance' : 'Report an incident'}
        ${templates.length && kind === 'incident' ? html`<select data-templates aria-label="Start from a template" style="width:auto;font-size:13px;padding:6px 10px"><option value="">Start from a template…</option>${templates.map((t) => html`<option value="${t.id}" data-title="${t.title}" data-body="${t.body}" data-impact="${t.impact}">${t.name}</option>`)}</select>` : ''}</h2>
        <label class="f">Title<input name="name" required maxlength="200" placeholder="${kind === 'maintenance' ? 'Planned maintenance on the mail platform' : 'E-mail delivery is delayed'}" autofocus></label>
        <div class="grid g2"><label class="f">Status<select name="status">${options(statuses, statuses[0]!)}</select></label>
          ${kind === 'incident' ? html`<label class="f">Impact<select name="impact">${options(IMPACTS, 'major')}</select></label>` : ''}</div>
        ${kind === 'maintenance' ? html`<div class="grid g2"><label class="f">Starts (${d.page.time_zone})<input type="datetime-local" name="scheduled_for" required></label>
          <label class="f">Ends (${d.page.time_zone})<input type="datetime-local" name="scheduled_until" required></label></div>
          <label class="check"><input type="checkbox" name="auto_transition" value="1" checked> Start and complete it automatically at those times</label>` : ''}
        <label class="f">Message <span class="hint">Markdown: **bold**, *italic*, [links](https://…), - lists</span><textarea name="body" required maxlength="5000" data-preview="pv" placeholder="What’s happening, who’s affected, and when we’ll update next."></textarea></label>
        <div><div class="small muted" style="margin-bottom:6px;font-weight:600">Preview</div><div id="pv" class="preview prose"></div></div>
      </section>
      <section class="card panel grid" style="align-content:start"><h2>Affected services</h2>${servicePicker(d, kind, 'major', new Map())}
        <p class="small faint" style="margin:0">${kind === 'maintenance' ? 'Services show “under maintenance” while it’s in progress.' : 'Ticked services take the status shown while the incident is open, and go back to operational when it’s resolved.'}</p>
        <button class="btn" type="submit" style="justify-content:center">${icon('bolt')}${kind === 'maintenance' ? 'Schedule maintenance' : 'Publish incident'}</button>
        <p class="tiny faint" style="margin:0;text-align:center">Subscribers are notified right away.</p>
      </section></form>`,
  });
}

function incidentView(d: PageData, app: App, id: string): Response | null {
  const i = d.incidents.find((x) => x.id === id);
  if (!i) return null;
  const base = `/admin/p/${d.page.slug}`;
  const ups = d.updates.filter((u) => u.incident_id === id).sort((a, b) => b.created_at.localeCompare(a.created_at));
  const linked = new Map(d.links.filter((l) => l.incident_id === id).map((l) => [l.component_id, d.components.find((c) => c.id === l.component_id)?.status ?? 'operational']));
  const statuses = i.kind === 'maintenance' ? MAINTENANCE_STATUSES : INCIDENT_STATUSES.filter((s) => s !== 'postmortem');
  const next = i.kind === 'maintenance' ? (i.status === 'scheduled' ? 'in_progress' : i.status === 'in_progress' ? 'completed' : i.status)
    : ({ investigating: 'identified', identified: 'monitoring', monitoring: 'resolved' } as Record<string, string>)[i.status] ?? 'resolved';
  return app({
    title: i.name, page: d, tab: 'incidents', crumbs: [['Dashboard', '/admin'], [d.page.name, base], ['Incidents', `${base}/incidents`], [i.name]],
    actions: html`<a class="btn ghost sm" href="/p/${d.page.slug}/incidents/${i.id}" target="_blank" rel="noopener">Public view ${icon('ext')}</a>`,
    body: html`<div class="page-title"><div><h1>${i.name}</h1><div class="row" style="margin-top:10px"><span class="pill s-${i.status}">${LABEL[i.status]}</span>
        ${i.kind === 'incident' ? html`<span class="pill plain i-${i.impact}">${LABEL[i.impact]} impact</span>` : html`<span class="pill plain i-maintenance">${when(i.scheduled_for, d.page.time_zone)} → ${when(i.scheduled_until, d.page.time_zone, { hour: '2-digit', minute: '2-digit' })}</span>`}
        <span class="small muted">${isOpen(i) ? (i.kind === 'maintenance' && i.status === 'scheduled' ? 'Not started' : `Open for ${duration(i.started_at, null)}`) : `Lasted ${duration(i.started_at, i.resolved_at)}`}</span></div></div></div>
      <div class="split">
        <form class="card panel grid" method="post" action="${base}/incidents/${i.id}"><h2>${isOpen(i) ? 'Post an update' : 'Post a follow-up'}</h2>
          <div class="grid g2"><label class="f">Status<select name="status">${options(statuses, next)}</select></label>
            ${i.kind === 'incident' ? html`<label class="f">Impact<select name="impact">${options(IMPACTS, i.impact)}</select></label>` : ''}</div>
          ${i.kind === 'maintenance' ? html`<div class="grid g2"><label class="f">Starts<input type="datetime-local" name="scheduled_for" value="${utcToZoned(i.scheduled_for, d.page.time_zone)}"></label>
            <label class="f">Ends<input type="datetime-local" name="scheduled_until" value="${utcToZoned(i.scheduled_until, d.page.time_zone)}"></label></div>` : ''}
          <label class="f">Message<textarea name="body" required maxlength="5000" data-preview="pv"></textarea></label>
          <div id="pv" class="preview prose"></div>
          <details${raw(linked.size ? '' : ' open')}><summary class="small muted" style="cursor:pointer">Affected services (${linked.size})</summary><div style="margin-top:10px">${servicePicker(d, i.kind, i.impact, linked)}</div></details>
          <div class="row end"><button class="btn" type="submit">Publish update</button></div>
        </form>
        <section class="card panel"><h2>Timeline</h2><ol class="timeline" style="--c:var(--accent)">${ups.map((u) => html`<li><span class="who">${LABEL[u.status] ?? u.status}</span><span class="when">${when(u.created_at, d.page.time_zone)}</span><div class="prose small">${raw(markdown(u.body))}</div></li>`)}</ol></section>
      </div>
      ${i.kind === 'incident' && !isOpen(i) ? html`<form class="card panel grid" method="post" action="${base}/incidents/${i.id}/postmortem"><h2>Postmortem</h2>
        <label class="f">What happened, why, and what changes <span class="hint">Markdown. Shown on the incident’s public page.</span><textarea name="postmortem" data-preview="pm" style="min-height:180px">${i.postmortem ?? ''}</textarea></label>
        <div id="pm" class="preview prose"></div><div class="row end"><button class="btn" type="submit">Save postmortem</button></div></form>` : ''}
      <form method="post" action="${base}/incidents/${i.id}/delete" class="row" data-confirm="Delete “${i.name}” and its history? It disappears from the page and the API."><button class="btn ghost sm" type="submit" style="color:var(--major)">Delete this ${i.kind}</button></form>`,
  });
}

// ---------- subscribers ----------

async function subscribersView(db: D1Database, d: PageData, app: App): Promise<Response> {
  const base = `/admin/p/${d.page.slug}`;
  const subs = (await db.prepare('SELECT id, kind, target, created_at, last_status, last_at, failures, active FROM subscribers WHERE page_id = ? ORDER BY created_at DESC').bind(d.page.id)
    .all<{ id: string; kind: string; target: string; created_at: string; last_status: number | null; last_at: string | null; failures: number; active: number }>()).results;
  const host = (u: string) => { try { const x = new URL(u); return `${x.host}${x.pathname.length > 18 ? `${x.pathname.slice(0, 18)}…` : x.pathname}`; } catch { return u; } };
  return app({
    title: 'Subscribers', page: d, tab: 'subscribers', crumbs: [['Dashboard', '/admin'], [d.page.name, base], ['Subscribers']],
    body: html`<section class="card panel"><h2>Notifications <span class="small muted">${subs.length}</span></h2>
      ${subs.length ? html`<table class="t"><thead><tr><th>Where</th><th>Kind</th><th>Last delivery</th><th></th></tr></thead><tbody>${subs.map((s) => html`<tr>
        <td><span class="mono small">${host(s.target)}</span>${s.active ? '' : html` <span class="pill c-major_outage">Off after ${s.failures} failures</span>`}</td>
        <td>${s.kind === 'slack' ? 'Slack / Teams' : 'Webhook'}</td>
        <td class="small">${s.last_at ? html`<span class="pill plain ${s.last_status && s.last_status < 300 ? 'c-operational' : 'c-major_outage'}">${s.last_status || 'no answer'}</span> ${ago(s.last_at, d.page.time_zone)}` : html`<span class="faint">Never</span>`}</td>
        <td><div class="row end"><form method="post" action="${base}/subscribers/${s.id}/test"><button class="btn ghost sm" type="submit">Send test</button></form>
          ${s.active ? '' : html`<form method="post" action="${base}/subscribers/${s.id}/enable"><button class="btn ghost sm" type="submit">Turn on</button></form>`}
          <form method="post" action="${base}/subscribers/${s.id}/delete" data-confirm="Remove this subscriber?"><button class="btn ghost sm" type="submit" aria-label="Remove">✕</button></form></div></td></tr>`)}</tbody></table>`
        : html`<p class="empty">No subscribers yet. Add a webhook, or a Slack or Teams channel, below.</p>`}</section>
      <form class="card panel grid" method="post" action="${base}/subscribers"><h2>Add a subscriber</h2>
        <div class="grid g2"><label class="f">Kind<select name="kind"><option value="slack">Slack / Teams incoming webhook (text)</option><option value="webhook">Webhook (JSON, signed)</option></select></label>
          <label class="f">URL<input name="target" type="url" required placeholder="https://hooks.slack.com/services/…"></label></div>
        <p class="small faint" style="margin:0">Webhooks get the incident in the v2 JSON shape, signed: <code>X-Pulsar-Signature: t=…,v1=HMAC-SHA256(secret, "t.body")</code>. The secret is shown once when you add it.</p>
        <div class="row end"><button class="btn" type="submit">Add</button></div></form>`,
  });
}

async function addSubscriber(db: D1Database, user: User, d: PageData, f: Form): Promise<Response> {
  const back = `/admin/p/${d.page.slug}/subscribers`;
  const kind = one(f, 'kind') === 'webhook' ? 'webhook' : 'slack'; const target = one(f, 'target');
  if (!httpsUrl(target) || target.length > 500) return flash(back, 'An https address.', 'err');
  const secret = b64(randomBytes(24)).replace(/[+/=]/g, '');
  try {
    await db.prepare('INSERT INTO subscribers (id, page_id, kind, target, secret, created_at) VALUES (?, ?, ?, ?, ?, ?)').bind(newId(), d.page.id, kind, target, secret, nowIso()).run();
  } catch { return flash(back, 'That address is subscribed already.', 'err'); }
  await audit(db, user.id, 'subscriber added', { page: d.page.slug, kind });
  return flash(back, kind === 'webhook' ? `Added. Signing secret (shown once): ${secret}` : 'Added. Send a test to check it.');
}

async function subscriberAction(db: D1Database, user: User, d: PageData, id: string, action: string, origin: string): Promise<Response> {
  const back = `/admin/p/${d.page.slug}/subscribers`;
  if (action === 'delete') { await db.prepare('DELETE FROM subscribers WHERE id = ? AND page_id = ?').bind(id, d.page.id).run(); await audit(db, user.id, 'subscriber removed', { page: d.page.slug }); return flash(back, 'Removed.'); }
  if (action === 'enable') { await db.prepare('UPDATE subscribers SET active = 1, failures = 0 WHERE id = ? AND page_id = ?').bind(id, d.page.id).run(); return flash(back, 'Turned on.'); }
  // A test: the latest incident, or a made-up one, to this subscriber only.
  if (!(await db.prepare('SELECT 1 FROM subscribers WHERE id = ? AND page_id = ?').bind(id, d.page.id).first())) return flash(back, 'No such subscriber.', 'err');
  const now = nowIso();
  const sample: IncidentRow = d.incidents[0] ?? { id: 'test00000000', page_id: d.page.id, kind: 'incident', name: 'Test notification from Pulsar', status: 'investigating', impact: 'minor', created_at: now, updated_at: now, started_at: now, monitoring_at: null, resolved_at: null, scheduled_for: null, scheduled_until: null };
  const data: PageData = d.incidents[0] ? d : { ...d, incidents: [sample], updates: [{ id: 'test00000000', incident_id: sample.id, status: 'investigating', body: 'This is a test. Nothing is wrong.', created_at: now }] };
  await notify(db, data, sample.id, 'test', origin, id);
  const code = (await db.prepare('SELECT last_status FROM subscribers WHERE id = ?').bind(id).first<{ last_status: number | null }>())?.last_status ?? 0;
  const ok = code >= 200 && code < 300;
  return flash(back, ok ? `Delivered (${code}).` : `Not delivered (${code || 'no answer'}).`, ok ? 'ok' : 'err');
}

// ---------- templates ----------

async function templatesView(db: D1Database, d: PageData, app: App): Promise<Response> {
  const base = `/admin/p/${d.page.slug}`;
  const ts = (await db.prepare('SELECT id, name, title, body, impact FROM templates WHERE page_id = ? ORDER BY name').bind(d.page.id).all<{ id: string; name: string; title: string; body: string; impact: string }>()).results;
  return app({
    title: 'Templates', page: d, tab: 'templates', crumbs: [['Dashboard', '/admin'], [d.page.name, base], ['Templates']],
    body: html`<section class="card panel"><h2>Templates <span class="small muted">Start an incident from one in a click</span></h2>
      ${ts.length ? ts.map((t) => html`<div class="list-row"><div><b>${t.name}</b> <span class="pill plain i-${t.impact}">${LABEL[t.impact]}</span><div class="small muted">${t.title}</div></div>
        <form method="post" action="${base}/templates/${t.id}/delete" data-confirm="Delete the template “${t.name}”?"><button class="btn ghost sm" type="submit" aria-label="Delete ${t.name}">✕</button></form></div>`) : html`<p class="empty">No templates yet.</p>`}</section>
      <form class="card panel grid" method="post" action="${base}/templates"><h2>New template</h2><div class="grid g2">
        <label class="f">Name<input name="name" required maxlength="60" placeholder="E-mail delays"></label>
        <label class="f">Impact<select name="impact">${options(IMPACTS, 'minor')}</select></label></div>
        <label class="f">Incident title<input name="title" required maxlength="200" placeholder="E-mail delivery is delayed"></label>
        <label class="f">First message<textarea name="body" required maxlength="5000" placeholder="We’re seeing delays in e-mail delivery and are investigating."></textarea></label>
        <div class="row end"><button class="btn" type="submit">Save template</button></div></form>`,
  });
}

async function addTemplate(db: D1Database, user: User, d: PageData, f: Form): Promise<Response> {
  const back = `/admin/p/${d.page.slug}/templates`;
  const name = one(f, 'name'); const title = one(f, 'title'); const body = one(f, 'body'); const impact = one(f, 'impact');
  if (!name || !title || !body || !(IMPACTS as readonly string[]).includes(impact)) return flash(back, 'A name, a title, a message and an impact.', 'err');
  await db.prepare('INSERT INTO templates (id, page_id, name, title, body, impact, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)').bind(newId(), d.page.id, name.slice(0, 60), title.slice(0, 200), body.slice(0, 5000), impact, nowIso()).run();
  await audit(db, user.id, 'template added', { page: d.page.slug, name });
  return flash(back, 'Template saved.');
}

// ---------- API keys ----------

async function keysView(db: D1Database, nav: NavPage[], app: App, created?: string): Promise<Response> {
  const keys = (await db.prepare('SELECT k.id, k.name, k.prefix, k.created_at, k.last_used, p.name AS page FROM api_keys k LEFT JOIN pages p ON p.id = k.page_id ORDER BY k.created_at DESC').all<{ id: string; name: string; prefix: string; created_at: string; last_used: string | null; page: string | null }>()).results;
  return app({
    title: 'API keys', crumbs: [['Dashboard', '/admin'], ['API keys']],
    body: html`<div class="page-title"><div><h1>API keys</h1><p>Open, update and resolve incidents, and set service status, from scripts and monitoring.</p></div></div>
      ${created ? html`<section class="card panel" style="border-color:color-mix(in oklab,var(--ok) 50%,transparent)"><h2>Your new key</h2><p class="small muted" style="margin-top:0">Copy it now. It’s shown only this once.</p>
        <code class="copy" data-copy="${created}" style="font-size:14px;padding:8px 12px;display:inline-block">${created}</code> <button class="btn ghost sm" type="button" data-copy="${created}">Copy</button></section>` : ''}
      <section class="card panel"><h2>Keys</h2>${keys.length ? html`<table class="t"><thead><tr><th>Name</th><th>Key</th><th>Page</th><th>Last used</th><th></th></tr></thead><tbody>${keys.map((k) => html`<tr>
        <td><b>${k.name}</b></td><td class="mono small">${k.prefix}…</td><td>${k.page ?? 'All pages'}</td><td class="small">${k.last_used ? ago(k.last_used, 'Europe/Oslo') : html`<span class="faint">Never</span>`}</td>
        <td><form method="post" action="/admin/keys/${k.id}/delete" data-confirm="Revoke “${k.name}”? Anything using it stops working."><button class="btn ghost sm" type="submit">Revoke</button></form></td></tr>`)}</tbody></table>` : html`<p class="empty">No keys yet.</p>`}</section>
      <form class="card panel grid" method="post" action="/admin/keys"><h2>New key</h2><div class="grid g2">
        <label class="f">Name<input name="name" required maxlength="60" placeholder="Monitoring"></label>
        <label class="f">Page<select name="page"><option value="">All pages</option>${nav.map((p) => html`<option value="${p.slug}">${p.name}</option>`)}</select></label></div>
        <div class="row end"><button class="btn" type="submit">Create key</button></div></form>
      <section class="card panel"><h2>Using the API</h2><div class="prose small">${raw(markdown(API_HELP))}</div></section>`,
  });
}
const API_HELP = `Send the key as \`Authorization: Bearer <key>\`. JSON in, JSON out.

- \`GET /api/v1/pages/<page>\`: the page, its services (with ids) and open incidents
- \`POST /api/v1/pages/<page>/incidents\` with \`{"name", "status", "impact", "body", "components": {"<id>": "major_outage"}}\`
- \`POST /api/v1/pages/<page>/incidents/<id>/updates\` with \`{"status", "body"}\` (status \`resolved\` closes it)
- \`PATCH /api/v1/pages/<page>/components/<id>\` with \`{"status"}\``;

async function createKey(db: D1Database, user: User, nav: NavPage[], f: Form, app: App): Promise<Response> {
  const name = one(f, 'name'); const slug = one(f, 'page');
  if (!name || name.length > 60) return flash('/admin/keys', 'A name for the key.', 'err');
  const page = slug ? await pageBySlug(db, slug) : null;
  if (slug && !page) return flash('/admin/keys', 'No such page.', 'err');
  const key = `pls_${b64(randomBytes(30)).replace(/[+/=]/g, '').slice(0, 40)}`;
  await db.prepare('INSERT INTO api_keys (id, page_id, name, key_hash, prefix, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)').bind(newId(), page?.id ?? null, name, await sha256(key), key.slice(0, 10), user.id, nowIso()).run();
  await audit(db, user.id, 'API key created', { name, page: slug || 'all' });
  return keysView(db, nav, app, key);
}

// ---------- admins and the log ----------

async function usersView(db: D1Database, user: User, app: App): Promise<Response> {
  const users = (await db.prepare('SELECT id, username, created_at FROM users ORDER BY username').all<{ id: string; username: string; created_at: string }>()).results;
  return app({
    title: 'Admins', crumbs: [['Dashboard', '/admin'], ['Admins']],
    body: html`<div class="page-title"><div><h1>Admins</h1><p>Everyone here can change every page.</p></div></div>
      <section class="card panel">${users.map((u) => html`<div class="list-row"><span class="row"><span class="avatar" aria-hidden="true">${u.username.charAt(0).toUpperCase()}</span><b>${u.username}</b>${u.id === user.id ? html`<span class="pill plain">You</span>` : ''}</span>
        ${u.id === user.id ? html`<span class="small faint">Since ${when(u.created_at, 'Europe/Oslo', { day: 'numeric', month: 'short', year: 'numeric' })}</span>` : html`<form method="post" action="/admin/users/${u.id}/delete" data-confirm="Remove ${u.username}?"><button class="btn ghost sm" type="submit">Remove</button></form>`}</div>`)}</section>
      <div class="split"><form class="card panel grid" method="post" action="/admin/users"><h2>Add an admin</h2>
        <label class="f">Username<input name="username" required maxlength="80" pattern="[A-Za-z0-9._@-]+" autocomplete="off"></label>
        <label class="f">Password <span class="hint">${PASSWORD_RULE}</span><input name="password" type="password" required minlength="12" maxlength="200" autocomplete="new-password"></label>
        <div class="row end"><button class="btn" type="submit">Add</button></div></form>
      <form class="card panel grid" method="post" action="/admin/password"><h2>Your password</h2>
        <label class="f">Current<input name="current" type="password" required autocomplete="current-password"></label>
        <label class="f">New <span class="hint">${PASSWORD_RULE} Signs you out everywhere.</span><input name="password" type="password" required minlength="12" maxlength="200" autocomplete="new-password"></label>
        <div class="row end"><button class="btn" type="submit">Change password</button></div></form></div>`,
  });
}

async function auditView(db: D1Database, app: App, url: URL): Promise<Response> {
  const before = url.searchParams.get('before') ?? '9999';
  const rows = (await db.prepare(`SELECT a.at, a.action, a.detail, coalesce(u.username, CASE WHEN a.user_id LIKE 'api:%' THEN 'API key ' || substr(a.user_id, 5) END) AS username FROM audit a LEFT JOIN users u ON u.id = a.user_id WHERE a.at < ? ORDER BY a.at DESC LIMIT 100`).bind(before).all<{ at: string; action: string; detail: string; username: string | null }>()).results;
  return app({
    title: 'Audit log', crumbs: [['Dashboard', '/admin'], ['Audit log']],
    body: html`<div class="page-title"><div><h1>Audit log</h1><p>Every change, by whom and when.</p></div><input type="search" placeholder="Filter…  ( / )" data-filter="table.t tbody tr" style="max-width:260px" aria-label="Filter the log"></div>
      <section class="card panel">${rows.length ? html`<table class="t"><thead><tr><th>When</th><th>Who</th><th>What</th><th>Details</th></tr></thead><tbody>${rows.map((r) => html`<tr>
        <td class="small">${when(r.at, 'Europe/Oslo', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', second: '2-digit' })}</td><td>${r.username ?? html`<span class="faint">Pulsar</span>`}</td><td>${r.action}</td><td class="small muted">${auditDetail(r.detail)}</td></tr>`)}</tbody></table>
        ${rows.length === 100 ? html`<p><a class="btn ghost sm" href="/admin/audit?before=${encodeURIComponent(rows[99]!.at)}">Older</a></p>` : ''}` : html`<p class="empty">Nothing yet.</p>`}</section>`,
  });
}

async function addUser(db: D1Database, user: User, f: Form): Promise<Response> {
  const username = one(f, 'username'); const password = f.get('password')?.[0] ?? '';
  if (!/^[A-Za-z0-9._@-]{2,80}$/.test(username)) return flash('/admin/users', 'A username: letters, digits, . _ @ -', 'err');
  if (!passwordOk(password)) return flash('/admin/users', PASSWORD_RULE, 'err');
  if (await db.prepare('SELECT 1 FROM users WHERE username = ?').bind(username).first()) return flash('/admin/users', 'That username is taken.', 'err');
  const p = await newPassword(password);
  await db.prepare('INSERT INTO users (id, username, pw_hash, pw_salt, iterations, created_at) VALUES (?, ?, ?, ?, ?, ?)').bind(newId(), username, p.pw_hash, p.pw_salt, p.iterations, nowIso()).run();
  await audit(db, user.id, 'admin added', { username });
  return flash('/admin/users', `Added ${username}.`);
}

async function deleteUser(db: D1Database, user: User, id: string): Promise<Response> {
  if (id === user.id) return flash('/admin/users', 'You can’t remove yourself.', 'err');
  const u = await db.prepare('SELECT username FROM users WHERE id = ?').bind(id).first<{ username: string }>();
  if (!u) return flash('/admin/users', 'No such admin.', 'err');
  await db.prepare('DELETE FROM users WHERE id = ?').bind(id).run();
  await audit(db, user.id, 'admin removed', { username: u.username });
  return flash('/admin/users', `Removed ${u.username}.`);
}

async function changePassword(db: D1Database, user: User, f: Form): Promise<Response> {
  const current = f.get('current')?.[0] ?? ''; const password = f.get('password')?.[0] ?? '';
  if (!passwordOk(password)) return flash('/admin/users', PASSWORD_RULE, 'err');
  const check = await verify(db, `pw:${user.id}`, user.username, current);
  if (!check.ok) return flash('/admin/users', check.reason === 'limited' ? 'Too many tries. Wait 15 minutes.' : 'The current password is wrong.', 'err');
  const p = await newPassword(password);
  await db.batch([
    db.prepare('UPDATE users SET pw_hash = ?, pw_salt = ?, iterations = ? WHERE id = ?').bind(p.pw_hash, p.pw_salt, p.iterations, user.id),
    db.prepare('DELETE FROM sessions WHERE user_id = ?').bind(user.id),
  ]);
  await audit(db, user.id, 'password changed', {});
  return redirect('/admin/login?ok=' + encodeURIComponent('Password changed. Sign in again.'));
}

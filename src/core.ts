/**
 * What changes a page, in one place for the admin, the write API and the schedule: opening an
 * incident or maintenance, posting updates, a service's status (with its history, for uptime),
 * maintenance starting and completing on its own, and telling subscribers.
 */
import { COMPONENT_STATUSES, IMPACTS, INCIDENT_STATUSES, MAINTENANCE_STATUSES, incidentJson, isOpen, type IncidentRow, type PageData } from './format.ts';
import { audit, loadPage, newId, nowIso, zonedToUtc } from './db.ts';
import { plain } from './markdown.ts';

export class Invalid extends Error {}
const has = (list: readonly string[], v: string) => list.includes(v);

/** A service's status, and the history line uptime is computed from (only on a change). */
export function statusStmts(db: D1Database, componentId: string, from: string, to: string, at: string): D1PreparedStatement[] {
  if (from === to) return [];
  return [
    db.prepare('UPDATE components SET status = ?, updated_at = ? WHERE id = ?').bind(to, at, componentId),
    db.prepare('INSERT INTO component_status_log (component_id, status, at) VALUES (?, ?, ?)').bind(componentId, to, at),
  ];
}

export interface IncidentInput {
  kind: 'incident' | 'maintenance';
  name: string; status: string; impact?: string; body: string;
  /** affected services and what each becomes */
  components: Record<string, string>;
  scheduled_for?: string | null; scheduled_until?: string | null;
  /** a `datetime-local` in the page's zone (forms) instead of ISO (the API) */
  local?: boolean;
  auto_transition?: boolean;
}

const DEFAULT_COMPONENT: Record<string, string> = { none: 'operational', minor: 'degraded_performance', major: 'partial_outage', critical: 'major_outage', maintenance: 'under_maintenance' };
export const defaultComponentStatus = (kind: string, impact: string) => DEFAULT_COMPONENT[kind === 'maintenance' ? 'maintenance' : impact] ?? 'degraded_performance';

function times(d: PageData, i: Pick<IncidentInput, 'scheduled_for' | 'scheduled_until' | 'local'>) {
  const conv = (v: string | null | undefined) => (!v ? null : i.local ? zonedToUtc(v, d.page.time_zone) : Number.isFinite(Date.parse(v)) ? new Date(v).toISOString() : null);
  return { from: conv(i.scheduled_for), until: conv(i.scheduled_until) };
}
const liveMaintenance = (status: string) => status === 'in_progress' || status === 'verifying';

/** Services another open incident (or maintenance under way) is holding down. */
function heldElsewhere(d: PageData, exceptId: string) {
  return new Set(d.links.filter((l) => l.incident_id !== exceptId && d.incidents.some((x) => x.id === l.incident_id && isOpen(x) && (x.kind === 'incident' || liveMaintenance(x.status)))).map((l) => l.component_id));
}

export async function openIncident(db: D1Database, d: PageData, actor: string | null, inp: IncidentInput): Promise<string> {
  const name = inp.name.trim(); const body = inp.body.trim();
  const impact = inp.kind === 'maintenance' ? 'maintenance' : inp.impact ?? 'minor';
  if (!name || name.length > 200) throw new Invalid('A title (up to 200 characters).');
  if (!body || body.length > 5000) throw new Invalid('A message (up to 5,000 characters).');
  if (!has(inp.kind === 'maintenance' ? MAINTENANCE_STATUSES : INCIDENT_STATUSES, inp.status)) throw new Invalid('Not a status for this.');
  if (inp.kind === 'incident' && !has(IMPACTS, impact)) throw new Invalid('Impact: none, minor, major or critical.');
  const { from, until } = times(d, inp);
  if (inp.kind === 'maintenance' && (!from || !until || until <= from)) throw new Invalid('When the maintenance starts and ends (the end after the start).');
  const comps = Object.entries(inp.components).filter(([c, s]) => d.components.some((x) => x.id === c) && has(COMPONENT_STATUSES, s));
  const id = newId(); const now = nowIso();
  const stmts: D1PreparedStatement[] = [
    db.prepare(`INSERT INTO incidents (id, page_id, kind, name, status, impact, created_at, updated_at, started_at, monitoring_at, resolved_at, scheduled_for, scheduled_until, auto_transition)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).bind(id, d.page.id, inp.kind, name, inp.status, impact, now, now, from ?? now,
      inp.status === 'monitoring' ? now : null, isOpen({ kind: inp.kind, status: inp.status }) ? null : now, from, until, inp.auto_transition === false ? 0 : 1),
    db.prepare('INSERT INTO incident_updates (id, incident_id, status, body, created_at) VALUES (?, ?, ?, ?, ?)').bind(newId(), id, inp.status, body, now),
    db.prepare('UPDATE pages SET updated_at = ? WHERE id = ?').bind(now, d.page.id),
  ];
  // Scheduled maintenance leaves services alone until it's under way.
  const touch = inp.kind === 'incident' ? isOpen({ kind: 'incident', status: inp.status }) : liveMaintenance(inp.status);
  for (const [c, s] of comps) {
    stmts.push(db.prepare('INSERT INTO incident_components (incident_id, component_id) VALUES (?, ?)').bind(id, c));
    if (touch) stmts.push(...statusStmts(db, c, d.components.find((x) => x.id === c)!.status, s, now));
  }
  await db.batch(stmts);
  await audit(db, actor, `${inp.kind} opened`, { page: d.page.slug, id, name, impact });
  return id;
}

export interface UpdateInput {
  status: string; body: string; impact?: string;
  /** affected services now (undefined: as they were) */
  components?: Record<string, string>;
  scheduled_for?: string | null; scheduled_until?: string | null; local?: boolean;
}

export async function postUpdate(db: D1Database, d: PageData, actor: string | null, id: string, inp: UpdateInput): Promise<IncidentRow> {
  const i = d.incidents.find((x) => x.id === id);
  if (!i) throw new Invalid('No such incident.');
  const body = inp.body.trim();
  if (!has(i.kind === 'maintenance' ? MAINTENANCE_STATUSES : INCIDENT_STATUSES, inp.status)) throw new Invalid('Not a status for this.');
  if (!body || body.length > 5000) throw new Invalid('A message (up to 5,000 characters).');
  const impact = i.kind === 'maintenance' ? 'maintenance' : inp.impact || i.impact;
  if (i.kind === 'incident' && !has(IMPACTS, impact)) throw new Invalid('Impact: none, minor, major or critical.');
  let from = i.scheduled_for; let until = i.scheduled_until;
  if (i.kind === 'maintenance') {
    const t = times(d, inp);
    from = t.from ?? from; until = t.until ?? until;
    if (from && until && until <= from) throw new Invalid('The end must be after the start.');
  }
  const now = nowIso();
  const closing = !isOpen({ kind: i.kind, status: inp.status });
  const before = new Map(d.links.filter((l) => l.incident_id === id).map((l) => [l.component_id, true]));
  const chosen = inp.components
    ? new Map(Object.entries(inp.components).filter(([c, s]) => d.components.some((x) => x.id === c) && has(COMPONENT_STATUSES, s)))
    : new Map([...before.keys()].map((c) => [c, d.components.find((x) => x.id === c)!.status]));
  const stmts: D1PreparedStatement[] = [
    db.prepare(`UPDATE incidents SET status = ?, impact = ?, updated_at = ?, monitoring_at = CASE WHEN ? = 'monitoring' THEN coalesce(monitoring_at, ?) ELSE monitoring_at END,
      resolved_at = CASE WHEN ? THEN coalesce(resolved_at, ?) ELSE NULL END, scheduled_for = ?, scheduled_until = ? WHERE id = ?`)
      .bind(inp.status, impact, now, inp.status, now, closing ? 1 : 0, now, from, until, id),
    db.prepare('INSERT INTO incident_updates (id, incident_id, status, body, created_at) VALUES (?, ?, ?, ?, ?)').bind(newId(), id, inp.status, body, now),
    db.prepare('DELETE FROM incident_components WHERE incident_id = ?').bind(id),
    db.prepare('UPDATE pages SET updated_at = ? WHERE id = ?').bind(now, d.page.id),
  ];
  for (const c of chosen.keys()) stmts.push(db.prepare('INSERT INTO incident_components (incident_id, component_id) VALUES (?, ?)').bind(id, c));
  // While open (maintenance: once under way) the services are as chosen; closed, or no longer
  // affected, they're operational again unless another open incident holds them.
  const held = heldElsewhere(d, id);
  const touch = i.kind === 'incident' || liveMaintenance(inp.status);
  for (const c of d.components) {
    if (!closing && touch && chosen.has(c.id)) stmts.push(...statusStmts(db, c.id, c.status, chosen.get(c.id)!, now));
    else if ((closing && (chosen.has(c.id) || before.has(c.id))) || (before.has(c.id) && !chosen.has(c.id))) {
      if (!held.has(c.id)) stmts.push(...statusStmts(db, c.id, c.status, 'operational', now));
    }
  }
  await db.batch(stmts);
  await audit(db, actor, 'update posted', { page: d.page.slug, id, status: inp.status });
  return { ...i, status: inp.status, impact, updated_at: now };
}

export async function deleteIncident(db: D1Database, d: PageData, actor: string | null, id: string) {
  const i = d.incidents.find((x) => x.id === id);
  if (!i) throw new Invalid('No such incident.');
  const now = nowIso(); const held = heldElsewhere(d, id);
  const stmts = [db.prepare('DELETE FROM incidents WHERE id = ?').bind(id)];
  if (isOpen(i) && (i.kind === 'incident' || liveMaintenance(i.status))) {
    for (const l of d.links.filter((x) => x.incident_id === id)) if (!held.has(l.component_id)) {
      stmts.push(...statusStmts(db, l.component_id, d.components.find((c) => c.id === l.component_id)?.status ?? 'operational', 'operational', now));
    }
  }
  await db.batch(stmts);
  await audit(db, actor, `${i.kind} deleted`, { page: d.page.slug, id, name: i.name });
}

export async function setPostmortem(db: D1Database, d: PageData, actor: string | null, id: string, text: string) {
  const i = d.incidents.find((x) => x.id === id);
  if (!i || i.kind !== 'incident' || isOpen(i)) throw new Invalid('A postmortem is for a resolved incident.');
  if (text.length > 20000) throw new Invalid('Up to 20,000 characters.');
  await db.prepare(`UPDATE incidents SET postmortem = ?, status = CASE WHEN ? = '' THEN 'resolved' ELSE 'postmortem' END, updated_at = ? WHERE id = ?`).bind(text.trim() || null, text.trim(), nowIso(), id).run();
  await audit(db, actor, 'postmortem', { page: d.page.slug, id });
}

/** Set a service's status by hand (admin or API). */
export async function setComponentStatus(db: D1Database, d: PageData, actor: string | null, id: string, status: string) {
  const c = d.components.find((x) => x.id === id);
  if (!c) throw new Invalid('No such service.');
  if (!has(COMPONENT_STATUSES, status)) throw new Invalid('Not a service status.');
  await db.batch(statusStmts(db, id, c.status, status, nowIso()));
  await audit(db, actor, 'service status', { page: d.page.slug, name: c.name, status });
}

// ---------- the schedule ----------

/** Maintenance that should have started, or ended, by now (cron, every few minutes). */
export async function runSchedule(env: { DB: D1Database; PUBLIC_URL?: string }, ctx: { waitUntil(p: Promise<unknown>): void }) {
  const now = nowIso();
  const due = (await env.DB.prepare(`SELECT i.id, i.status, i.scheduled_for, i.scheduled_until, p.slug FROM incidents i JOIN pages p ON p.id = i.page_id
    WHERE i.kind = 'maintenance' AND i.auto_transition = 1 AND ((i.status = 'scheduled' AND i.scheduled_for <= ?) OR (i.status IN ('in_progress', 'verifying') AND i.scheduled_until <= ?))`)
    .bind(now, now).all<{ id: string; status: string; slug: string }>()).results;
  for (const m of due) {
    const d = await loadPage(env.DB, m.slug);
    if (!d) continue;
    const starting = m.status === 'scheduled';
    const body = starting ? 'The maintenance has started.' : 'The maintenance is complete.';
    const comps = Object.fromEntries(d.links.filter((l) => l.incident_id === m.id).map((l) => [l.component_id, 'under_maintenance']));
    await postUpdate(env.DB, d, null, m.id, { status: starting ? 'in_progress' : 'completed', body, components: comps });
    const fresh = await loadPage(env.DB, m.slug);
    if (fresh) ctx.waitUntil(notify(env.DB, fresh, m.id, starting ? 'maintenance.started' : 'maintenance.completed', publicUrl(env)));
  }
}

// ---------- subscribers ----------

/** Where the pages live, for links in what the cron sends (no request to take it from): PUBLIC_URL. */
const publicUrl = (env: { PUBLIC_URL?: string }) => env.PUBLIC_URL?.trim().replace(/\/+$/, '') || 'http://localhost:8787';

async function hmac(secret: string, body: string) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return [...new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(body)))].map((b) => b.toString(16).padStart(2, '0')).join('');
}

const STATUS_WORD: Record<string, string> = { investigating: 'Investigating', identified: 'Identified', monitoring: 'Monitoring', resolved: 'Resolved', postmortem: 'Postmortem', scheduled: 'Scheduled', in_progress: 'In progress', verifying: 'Verifying', completed: 'Completed' };

/** Tell every active subscriber of the page about an incident's change. Never throws. */
export async function notify(db: D1Database, d: PageData, incidentId: string, event: string, origin: string, only?: string) {
  try {
    const i = d.incidents.find((x) => x.id === incidentId);
    if (!i) return;
    const subs = (only
      ? await db.prepare('SELECT id, kind, target, secret FROM subscribers WHERE page_id = ? AND id = ?').bind(d.page.id, only).all<{ id: string; kind: string; target: string; secret: string }>()
      : await db.prepare('SELECT id, kind, target, secret FROM subscribers WHERE page_id = ? AND active = 1').bind(d.page.id).all<{ id: string; kind: string; target: string; secret: string }>()).results;
    if (!subs.length) return;
    const comps = d.links.filter((l) => l.incident_id === i.id).map((l) => d.components.find((c) => c.id === l.component_id)).filter((c) => !!c);
    const json = incidentJson(i, d.updates.filter((u) => u.incident_id === i.id), comps, origin, d.page.slug);
    const latest = d.updates.filter((u) => u.incident_id === i.id).sort((a, b) => b.created_at.localeCompare(a.created_at))[0];
    const url = `${origin}/p/${d.page.slug}/incidents/${i.id}`;
    await Promise.all(subs.map(async (s) => {
      const body = s.kind === 'slack'
        ? JSON.stringify({ text: `*${d.page.name}: ${i.name}* — ${STATUS_WORD[i.status] ?? i.status}\n${plain(latest?.body ?? '')}\n<${url}|Details>` })
        : JSON.stringify({ event, page: { id: d.page.id, slug: d.page.slug, name: d.page.name, url: `${origin}/p/${d.page.slug}` }, incident: json });
      const t = Math.floor(Date.now() / 1000);
      let code = 0;
      try {
        const res = await fetch(s.target, { method: 'POST', redirect: 'manual', signal: AbortSignal.timeout(8000), headers: {
          'content-type': 'application/json', 'user-agent': 'Pulsar-Webhook/1', 'x-pulsar-event': event,
          ...(s.kind === 'webhook' ? { 'x-pulsar-signature': `t=${t},v1=${await hmac(s.secret, `${t}.${body}`)}` } : {}),
        }, body });
        code = res.status;
      } catch { code = 0; }
      const ok = code >= 200 && code < 300;
      await db.prepare(`UPDATE subscribers SET last_status = ?, last_at = ?, failures = CASE WHEN ? THEN 0 ELSE failures + 1 END, active = CASE WHEN ? THEN active WHEN failures + 1 >= 20 THEN 0 ELSE active END WHERE id = ?`)
        .bind(code, nowIso(), ok ? 1 : 0, ok ? 1 : 0, s.id).run();
    }));
  } catch (e) { console.error('pulsar: notify failed', (e as Error).message); }
}

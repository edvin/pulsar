/**
 * The write API (/api/v1), for scripts and monitoring: a Bearer key (Admin → API keys), JSON in
 * and out. A key for one page can only touch that page.
 *
 *   GET   /api/v1/pages/<page>                               the page, services (ids), open incidents
 *   POST  /api/v1/pages/<page>/incidents                     open an incident or maintenance
 *   POST  /api/v1/pages/<page>/incidents/<id>/updates        post an update (resolved closes it)
 *   PATCH /api/v1/pages/<page>/components/<id>               set a service's status
 */
import { sha256 } from './auth.ts';
import { Invalid, notify, openIncident, postUpdate, setComponentStatus } from './core.ts';
import { loadPage, nowIso } from './db.ts';
import { componentJson, incidentJson, isOpen, summary } from './format.ts';

type Ctx = { waitUntil(p: Promise<unknown>): void };
const J = { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' };
const out = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: J });
const fail = (status: number, error: string) => out({ error }, status);

export async function handleApi(req: Request, env: { DB: D1Database }, url: URL, ctx: Ctx): Promise<Response> {
  const db = env.DB;
  const token = /^Bearer\s+(pls_[A-Za-z0-9]{20,60})$/.exec(req.headers.get('authorization') ?? '')?.[1];
  if (!token) return fail(401, 'Send an API key: Authorization: Bearer pls_…');
  const key = await db.prepare('SELECT id, page_id, name FROM api_keys WHERE key_hash = ?').bind(await sha256(token)).first<{ id: string; page_id: string | null; name: string }>();
  if (!key) return fail(401, 'Unknown API key.');
  ctx.waitUntil(db.prepare('UPDATE api_keys SET last_used = ? WHERE id = ?').bind(nowIso(), key.id).run());

  const m = /^\/api\/v1\/pages\/([a-z0-9-]{1,40})(\/.*)?$/.exec(url.pathname);
  if (!m) return fail(404, 'Not found.');
  const d = await loadPage(db, m[1]!);
  if (!d || (key.page_id && key.page_id !== d.page.id)) return fail(404, 'No such page (for this key).');
  const rest = m[2] ?? '';
  const actor = `api:${key.name}`;
  const body = async () => { try { return (await req.json()) as Record<string, unknown>; } catch { throw new Invalid('The body must be JSON.'); } };
  const str = (v: unknown) => (typeof v === 'string' ? v : '');
  const comps = (v: unknown) => (v && typeof v === 'object' ? Object.fromEntries(Object.entries(v as Record<string, unknown>).map(([k, s]) => [k, str(s)])) : {});
  try {
    if (rest === '' && req.method === 'GET') {
      const s = summary(d, url.origin);
      return out({ page: s.page, status: s.status, components: d.components.map(componentJson), incidents: s.incidents, scheduled_maintenances: s.scheduled_maintenances });
    }
    if (rest === '/incidents' && req.method === 'POST') {
      const b = await body();
      const kind = b.kind === 'maintenance' ? 'maintenance' : 'incident';
      const id = await openIncident(db, d, actor, { kind, name: str(b.name), status: str(b.status) || (kind === 'maintenance' ? 'scheduled' : 'investigating'), impact: str(b.impact) || 'minor', body: str(b.body), components: comps(b.components),
        scheduled_for: str(b.scheduled_for) || null, scheduled_until: str(b.scheduled_until) || null, auto_transition: b.auto_transition !== false });
      const fresh = (await loadPage(db, d.page.slug))!;
      ctx.waitUntil(notify(db, fresh, id, kind === 'maintenance' ? 'maintenance.scheduled' : 'incident.created', url.origin));
      return out(one(fresh, id, url.origin), 201);
    }
    let c = /^\/incidents\/([a-z0-9]{12})\/updates$/.exec(rest);
    if (c && req.method === 'POST') {
      const b = await body();
      const i = await postUpdate(db, d, actor, c[1]!, { status: str(b.status), body: str(b.body), impact: str(b.impact) || undefined, components: b.components === undefined ? undefined : comps(b.components),
        scheduled_for: str(b.scheduled_for) || null, scheduled_until: str(b.scheduled_until) || null });
      const fresh = (await loadPage(db, d.page.slug))!;
      ctx.waitUntil(notify(db, fresh, i.id, isOpen(i) ? `${i.kind}.updated` : `${i.kind}.${i.kind === 'maintenance' ? 'completed' : 'resolved'}`, url.origin));
      return out(one(fresh, i.id, url.origin));
    }
    c = /^\/incidents\/([a-z0-9]{12})$/.exec(rest);
    if (c && req.method === 'GET') { const r = one(d, c[1]!, url.origin); return r ? out(r) : fail(404, 'No such incident.'); }
    c = /^\/components\/([a-z0-9]{12})$/.exec(rest);
    if (c && req.method === 'PATCH') {
      const b = await body();
      await setComponentStatus(db, d, actor, c[1]!, str(b.status));
      const fresh = (await loadPage(db, d.page.slug))!;
      return out(componentJson(fresh.components.find((x) => x.id === c![1])!));
    }
    return fail(404, 'Not found.');
  } catch (e) {
    if (e instanceof Invalid) return fail(422, e.message);
    throw e;
  }
}

function one(d: Awaited<ReturnType<typeof loadPage>> & {}, id: string, origin: string) {
  const i = d.incidents.find((x) => x.id === id);
  if (!i) return null;
  const comps = d.links.filter((l) => l.incident_id === id).map((l) => d.components.find((c) => c.id === l.component_id)).filter((c) => !!c);
  return incidentJson(i, d.updates.filter((u) => u.incident_id === id), comps, origin, d.page.slug);
}

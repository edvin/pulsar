/**
 * Pulsar: status pages on Cloudflare Workers and D1.
 *
 *   /                                    the product page
 *   /p/<page>                            the public status page (/incidents/<id>, /history)
 *   /p/<page>/api/v2/*.json              the read API in the common v2 format (summary, incidents, status, scheduled-maintenances)
 *   /p/<page>/history.rss|.atom          feeds;  /p/<page>/badge.svg  a status badge
 *   /api/v1/…                            the write API (api.ts)
 *   /admin                               the admin app (admin.ts)
 *   /assets/pulsar.css|.js               the stylesheet and script
 * A cron runs scheduled maintenance (core.ts).
 */
import { handleAdmin } from './admin.ts';
import { handleApi } from './api.ts';
import { CSS, JS } from './assets.ts';
import { runSchedule } from './core.ts';
import { loadPage } from './db.ts';
import { incidentsList, maintenancesList, status, summary, type PageData } from './format.ts';
import { SECURITY_HEADERS, localDate } from './html.ts';
import { badge, feed, historyPage, home, incidentPage, statusPage } from './public.ts';
import { loadUptime } from './uptime.ts';

export interface Env { DB: D1Database; PUBLIC_URL?: string }

const JSON_HEADERS = {
  'content-type': 'application/json; charset=utf-8',
  'access-control-allow-origin': '*',
  'cache-control': 'no-store',
  'x-content-type-options': 'nosniff',
};
const API: Record<string, (d: PageData, origin: string) => unknown> = { 'summary.json': summary, 'incidents.json': incidentsList, 'status.json': status, 'scheduled-maintenances.json': maintenancesList };
const notFound = () => new Response('Not found.', { status: 404, headers: SECURITY_HEADERS });

/**
 * The status page, rendered once and kept at the edge (Cache API) under a key that changes with
 * anything on it: the page, every service's status and every incident's last change, and the day
 * (the uptime bars). So a visitor never sees it stale, and most requests don't render at all.
 */
async function cachedPage(req: Request, d: PageData, ctx: ExecutionContext, render: () => Promise<Response>): Promise<Response> {
  const sig = [d.page.updated_at, localDate(new Date().toISOString(), d.page.time_zone), ...d.components.map((c) => `${c.id}${c.status}${c.updated_at}`), ...d.incidents.map((i) => `${i.id}${i.updated_at}`)].join('|');
  let h = 2166136261; for (let i = 0; i < sig.length; i++) { h ^= sig.charCodeAt(i); h = Math.imul(h, 16777619); }
  // the host too: a page served at its own hostname links differently (pageAtHost)
  const key = new Request(`https://cache.pulsar/${new URL(req.url).host}/${d.page.slug}/${(h >>> 0).toString(36)}`);
  const cache = (caches as unknown as { default: Cache }).default;
  const hit = await cache.match(key).catch(() => undefined);
  if (hit) return new Response(hit.body, hit);
  const res = await render();
  const stored = new Response(res.clone().body, res); stored.headers.set('cache-control', 'public, max-age=3600');
  ctx.waitUntil(cache.put(key, stored).catch(() => {}));
  void req;
  return res;
}

/** Which page has this hostname (pages.hostname), kept a minute per isolate; null: none. */
const hostPages = new Map<string, { slug: string | null; at: number }>();
async function pageForHost(db: D1Database, host: string): Promise<string | null> {
  const hit = hostPages.get(host);
  if (hit && Date.now() - hit.at < 60_000) return hit.slug;
  const row = await db.prepare('SELECT slug FROM pages WHERE hostname = ?').bind(host).first<{ slug: string }>().catch(() => null);
  hostPages.set(host, { slug: row?.slug ?? null, at: Date.now() });
  return row?.slug ?? null;
}

/**
 * A page at its own hostname: its paths are the /p/<slug> ones without that prefix ("/" is the
 * page, "/api/v2/summary.json" its API…), and what goes back has the prefix taken out of its links
 * (HTML, JSON, feeds). The admin and the write API stay on Pulsar's own host.
 */
async function pageAtHost(req: Request, env: Env, ctx: ExecutionContext, url: URL, slug: string): Promise<Response> {
  if (url.pathname === '/admin' || url.pathname.startsWith('/admin/') || url.pathname.startsWith('/api/v1/')) return notFound();
  if (url.pathname.startsWith('/assets/') || url.pathname === '/robots.txt' || url.pathname.startsWith(`/p/`)) return route(req, env, ctx, url);
  const inner = new URL(url); inner.pathname = `/p/${slug}${url.pathname === '/' ? '' : url.pathname}`;
  const res = await route(new Request(inner.toString(), req), env, ctx, inner);
  const type = res.headers.get('content-type') ?? '';
  if (!/html|json|xml|svg/.test(type) || !res.body) return res;
  const prefix = `/p/${slug}`;
  const body = (await res.text()).split(`"${prefix}"`).join('"/"').split(`${prefix}/`).join('/').split(prefix).join('');
  return new Response(body, { status: res.status, headers: res.headers });
}

export default {
  async fetch(req: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(req.url);
    try {
      if (url.protocol === 'http:' && url.hostname !== 'localhost' && url.hostname !== '127.0.0.1') {
        url.protocol = 'https:';
        return Response.redirect(url.toString(), 301);
      }
      // A page's own hostname (never Pulsar's own, nor local development)
      const own = env.PUBLIC_URL ? new URL(env.PUBLIC_URL).hostname : '';
      if (url.hostname !== own && url.hostname !== 'localhost' && url.hostname !== '127.0.0.1') {
        const slug = await pageForHost(env.DB, url.hostname);
        if (slug) return await pageAtHost(req, env, ctx, url, slug);
      }
      return await route(req, env, ctx, url);
    } catch (e) {
      console.error('pulsar: request failed', (e as Error).message, (e as Error).stack);
      return new Response('Something went wrong.', { status: 500 });
    }
  },
  async scheduled(_event: ScheduledController, env: Env, ctx: ExecutionContext) {
    await runSchedule(env, ctx);
  },
} satisfies ExportedHandler<Env>;

async function route(req: Request, env: Env, ctx: ExecutionContext, url: URL): Promise<Response> {
    {
      if (url.pathname === '/admin' || url.pathname.startsWith('/admin/')) {
        const res = await handleAdmin(req, env, url, ctx);
        const h = new Headers(res.headers); h.set('cache-control', 'no-store'); for (const [k, v] of Object.entries(SECURITY_HEADERS)) if (!h.has(k)) h.set(k, v);
        return new Response(res.body, { status: res.status, headers: h });
      }
      if (url.pathname.startsWith('/api/v1/')) {
        if (req.method === 'OPTIONS') return new Response(null, { status: 204 });
        return await handleApi(req, env, url, ctx);
      }
      if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: { ...JSON_HEADERS, 'access-control-allow-methods': 'GET, OPTIONS' } });
      if (req.method !== 'GET' && req.method !== 'HEAD') return new Response('Method not allowed.', { status: 405 });
      if (url.pathname === '/assets/pulsar.css') return new Response(CSS, { headers: { 'content-type': 'text/css; charset=utf-8', 'cache-control': 'public, max-age=86400' } });
      if (url.pathname === '/assets/pulsar.js') return new Response(JS, { headers: { 'content-type': 'text/javascript; charset=utf-8', 'cache-control': 'public, max-age=86400' } });
      if (url.pathname === '/' || url.pathname === '') {
        const pages = (await env.DB.prepare('SELECT slug, name, accent, logo_text FROM pages ORDER BY name').all<{ slug: string; name: string; accent: string; logo_text: string | null }>()).results;
        return home(pages);
      }
      if (url.pathname === '/robots.txt') return new Response('User-agent: *\nDisallow: /admin\nDisallow: /api/\n', { headers: { 'content-type': 'text/plain' } });

      const m = /^\/p\/([a-z0-9-]{1,40})(\/.*)?$/.exec(url.pathname);
      if (!m) return notFound();
      const rest = (m[2] ?? '').replace(/\/+$/, '');
      const api = /^\/api\/v2\/([a-z-]+\.json)$/.exec(rest);
      const d = await loadPage(env.DB, m[1]!);
      if (!d) return api ? Response.json({ error: 'not found' }, { status: 404, headers: JSON_HEADERS }) : new Response('No such page.', { status: 404, headers: SECURITY_HEADERS });
      if (api) {
        const build = API[api[1]!];
        return build ? new Response(JSON.stringify(build(d, url.origin)), { headers: JSON_HEADERS }) : Response.json({ error: 'not found' }, { status: 404, headers: JSON_HEADERS });
      }
      if (rest === '') return await cachedPage(req, d, ctx, async () => statusPage(d, await loadUptime(env.DB, d.page.id, d.page.time_zone, 90), url.origin));
      if (rest === '/history') return historyPage(d);
      if (rest === '/history.rss') return feed(d, url.origin, 'rss');
      if (rest === '/history.atom') return feed(d, url.origin, 'atom');
      if (rest === '/badge.svg') return badge(d);
      const inc = /^\/incidents\/([a-z0-9]{12})$/.exec(rest);
      if (inc) return incidentPage(d, inc[1]!) ?? new Response('No such incident.', { status: 404, headers: SECURITY_HEADERS });
      return notFound();
    }
}

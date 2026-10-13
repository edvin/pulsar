/** The public side: a page's status, one incident, the history, feeds and the badge. */
import { indicator, isOpen, type ComponentRow, type IncidentRow, type PageData } from './format.ts';
import { ago, document, duration, esc, fmt, html, icon, LABEL, localDate, raw, when, type Html } from './html.ts';
import { markdown, plain } from './markdown.ts';
import { computeUptime, lastDays, type Uptime } from './uptime.ts';

const markOf = (d: PageData) => d.page.logo_text?.trim() || d.page.name.trim().charAt(0).toUpperCase();

function header(d: PageData): Html {
  const base = `/p/${d.page.slug}`;
  return html`<header class="site-head"><div class="wrap">
    <a class="logo" href="${base}"><span class="mark" aria-hidden="true">${markOf(d)}</span><span>${d.page.name}</span></a>
    <div class="head-links">
      ${d.page.website_url ? html`<a class="btn ghost sm" href="${d.page.website_url}" rel="noopener">Website</a>` : ''}
      ${d.page.support_url ? html`<a class="btn ghost sm" href="${d.page.support_url}" rel="noopener">Support</a>` : ''}
      <a class="btn sm" href="${base}#subscribe">Subscribe</a>
      <button class="theme-toggle" type="button" data-theme-toggle aria-label="Switch light and dark">${icon('sun')}</button>
    </div></div></header>`;
}

function footer(d: PageData): Html {
  return html`<footer class="site-foot"><div class="wrap">
    <p><a href="/p/${d.page.slug}/history">Incident history</a> · <a href="/p/${d.page.slug}/history.rss">RSS</a> · <a href="/p/${d.page.slug}/api/v2/summary.json">API</a></p>
    ${d.page.hide_powered_by ? '' : html`<p class="powered"><span class="dot live" aria-hidden="true"></span> Powered by <a href="/">Pulsar</a></p>`}
  </div></footer>`;
}

const STATE_ICON: Record<string, string> = { none: 'check', minor: 'alert', major: 'alert', critical: 'alert', maintenance: 'wrench' };

function banner(d: PageData): Html {
  const s = indicator(d.components, d.incidents);
  const open = d.incidents.filter((i) => i.kind === 'incident' && isOpen(i)).length;
  return html`<section class="banner st-${s.indicator}" role="status" aria-live="polite">
    <div class="sig" aria-hidden="true">${icon(STATE_ICON[s.indicator] ?? 'check')}</div>
    <div><h2>${s.indicator === 'none' ? 'All systems operational' : s.description}</h2>
      <p>${open ? `${open} ongoing incident${open > 1 ? 's' : ''} · ` : ''}Updated ${ago(new Date().toISOString(), d.page.time_zone)}</p></div>
  </section>`;
}

const affected = (d: PageData, i: IncidentRow) => d.links.filter((l) => l.incident_id === i.id).map((l) => d.components.find((c) => c.id === l.component_id)).filter((c): c is ComponentRow => !!c);

function timeline(d: PageData, i: IncidentRow, max?: number): Html {
  const ups = d.updates.filter((u) => u.incident_id === i.id).sort((a, b) => b.created_at.localeCompare(a.created_at));
  const shown = max ? ups.slice(0, max) : ups;
  return html`<ol class="timeline">${shown.map((u) => html`<li><span class="who">${LABEL[u.status] ?? u.status}</span><span class="when">${when(u.created_at, d.page.time_zone)}</span>
    <div class="prose">${raw(markdown(u.body))}</div></li>`)}</ol>${max && ups.length > max ? html`<p class="small"><a href="/p/${d.page.slug}/incidents/${i.id}">See all ${ups.length} updates</a></p>` : ''}`;
}

function incidentCard(d: PageData, i: IncidentRow, opts: { full?: boolean } = {}): Html {
  const comps = affected(d, i);
  const tone = i.kind === 'maintenance' ? 'i-maintenance' : isOpen(i) ? `i-${i.impact}` : 'c-operational';
  const head = opts.full ? html`<h1 style="font-size:26px">${i.name}</h1>` : html`<h3><a href="/p/${d.page.slug}/incidents/${i.id}">${i.name}</a></h3>`;
  return html`<article class="card incident ${tone}">
    ${head}
    <div class="meta">
      <span class="pill s-${i.status}">${LABEL[i.status] ?? i.status}</span>
      ${i.kind === 'incident' ? html`<span class="pill plain i-${i.impact}">${LABEL[i.impact]} impact</span>` : ''}
      ${comps.map((c) => html`<span class="pill plain">${c.name}</span>`)}
      <span class="faint small">${i.kind === 'maintenance'
        ? `${when(i.scheduled_for, d.page.time_zone)} → ${when(i.scheduled_until, d.page.time_zone, { hour: '2-digit', minute: '2-digit', timeZoneName: 'short' })}`
        : isOpen(i) ? `Ongoing for ${duration(i.started_at, null)}` : `Lasted ${duration(i.started_at, i.resolved_at)}`}</span>
    </div>
    ${timeline(d, i, opts.full ? undefined : 3)}
    ${opts.full && i.postmortem ? html`<section style="margin-top:20px"><h3 style="font-size:16px;margin-bottom:6px">Postmortem</h3><div class="prose">${raw(markdown(i.postmortem))}</div></section>` : ''}
  </article>`;
}

/** Each service's incidents per local day, for the bars' tooltips. */
function incidentDays(d: PageData, days: string[]): Map<string, Map<string, string[]>> {
  const out = new Map<string, Map<string, string[]>>();
  const tz = d.page.time_zone;
  const local = (iso: string) => localDate(iso, tz);
  for (const i of d.incidents.filter((x) => x.kind === 'incident')) {
    const from = local(i.started_at); const to = local(i.resolved_at ?? new Date().toISOString());
    for (const day of days) if (day >= from && day <= to) {
      for (const c of affected(d, i)) {
        const m = out.get(c.id) ?? new Map<string, string[]>(); m.set(day, [...(m.get(day) ?? []), i.name]); out.set(c.id, m);
      }
    }
  }
  return out;
}

const dayNames = new Map<string, string>();
const dayName = (date: string) => {
  let n = dayNames.get(date);
  if (!n) { n = fmt('UTC', { day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(`${date}T12:00:00Z`)); if (dayNames.size > 1000) dayNames.clear(); dayNames.set(date, n); }
  return n;
};
const WORST_WORD: Record<string, string> = { none: 'No data', operational: 'No downtime' };

/** 90 bars for a service: built as one string (it's 1,800 elements on a busy page). */
function bars(_d: PageData, u: Uptime): Html {
  let out = '';
  for (const b of u.days) {
    const word = b.downMinutes ? `${b.downMinutes} min down` : WORST_WORD[b.worst] ?? LABEL[b.worst] ?? b.worst;
    const tip = b.incidents.length ? `${dayName(b.date)}\n${word}\n${b.incidents.slice(0, 3).join('\n')}` : `${dayName(b.date)}\n${word}`;
    out += `<span class="bar b-${b.worst}" tabindex="0" data-tip="${esc(tip)}"></span>`;
  }
  return html`<div class="bars" role="img" aria-label="${`${u.percent}% uptime over 90 days`}">${raw(out)}</div>
  <div class="bars-legend"><span>90 days ago</span><span class="line"></span><span>${u.percent.toFixed(2)}% uptime</span><span class="line"></span><span>Today</span></div>`;
}

function services(d: PageData, uptime: Map<string, Array<{ status: string; at: string }>>): Html {
  if (!d.components.length) return html`<p class="empty">No services listed yet.</p>`;
  const days = lastDays(90, d.page.time_zone);
  const incDays = incidentDays(d, days);
  const one = (c: ComponentRow) => {
    const u = computeUptime(uptime.get(c.id) ?? [], c.created_at, d.page.time_zone, 90, incDays.get(c.id));
    return html`<div class="svc"><div class="top"><div><div class="name">${c.name}</div>${c.description ? html`<div class="desc">${c.description}</div>` : ''}</div>
      <span class="pill c-${c.status}">${LABEL[c.status] ?? c.status}</span></div>${c.show_uptime === 0 ? '' : bars(d, u)}</div>`;
  };
  const groups = new Map<string, ComponentRow[]>();
  const loose: ComponentRow[] = [];
  for (const c of d.components) c.group_name ? groups.set(c.group_name, [...(groups.get(c.group_name) ?? []), c]) : loose.push(c);
  const worst = (cs: ComponentRow[]) => { const rank = ['operational', 'under_maintenance', 'degraded_performance', 'partial_outage', 'major_outage']; return cs.reduce((w, c) => (rank.indexOf(c.status) > rank.indexOf(w) ? c.status : w), 'operational'); };
  return html`<div class="card services">${loose.map(one)}${[...groups].map(([g, cs]) => {
    const w = worst(cs);
    return html`<details class="group"${raw(w !== 'operational' ? ' open' : '')}><summary><span>${g} <span class="faint small">· ${cs.length} services</span></span>
      <span class="row"><span class="pill c-${w}">${LABEL[w]}</span><span class="chev">${icon('chev')}</span></span></summary>${cs.map(one)}</details>`;
  })}</div>`;
}

function pastByDay(d: PageData, n: number): Html {
  const tz = d.page.time_zone;
  const days = lastDays(n, tz).reverse();
  const closed = d.incidents.filter((i) => i.kind === 'incident' && !isOpen(i));
  return html`<div class="card">${days.map((day) => {
    const list = closed.filter((i) => localDate(i.started_at, tz) === day);
    const label = fmt('UTC', { weekday: 'long', day: 'numeric', month: 'long' }).format(new Date(`${day}T12:00:00Z`));
    if (!list.length) return html`<div class="history-day quiet"><h4>${label}</h4><p class="empty small">No incidents</p></div>`;
    return html`<div class="history-day"><h4>${label}</h4>${list.map((i) => html`<div style="margin:8px 0"><a href="/p/${d.page.slug}/incidents/${i.id}" style="font-weight:650">${i.name}</a>
        <div class="small muted">${LABEL[i.status]} · lasted ${duration(i.started_at, i.resolved_at)}</div></div>`)}</div>`;
  })}</div>`;
}

function subscribe(d: PageData, origin: string): Html {
  const base = `${origin}/p/${d.page.slug}`;
  return html`<section class="section" id="subscribe"><h2>Stay in the loop</h2><div class="card subscribe">
    <p class="muted" style="margin:0">Follow ${d.page.name}'s status in the tools you already use.</p>
    <div class="opts">
      <a class="opt" href="/p/${d.page.slug}/history.rss">${icon('rss')}<div><b>RSS feed</b><span>Every incident and update</span></div></a>
      <a class="opt" href="/p/${d.page.slug}/history.atom">${icon('rss')}<div><b>Atom feed</b><span>For feed readers that prefer it</span></div></a>
      <a class="opt" href="/p/${d.page.slug}/api/v2/summary.json">${icon('code')}<div><b>JSON API</b><span>v2 format: summary, incidents, status</span></div></a>
      <button class="opt" type="button" data-copy="${`<img src="${base}/badge.svg" alt="${d.page.name} status">`}" style="text-align:left;cursor:pointer;font:inherit">${icon('bolt')}<div><b>Status badge</b><span>Copy an embeddable badge</span></div></button>
    </div>
    <p class="small faint" style="margin:14px 0 0">Webhooks and Slack or Teams notifications: ask the page's admins.</p>
  </div></section>`;
}

export function statusPage(d: PageData, uptime: Map<string, Array<{ status: string; at: string }>>, origin: string): Response {
  const open = d.incidents.filter((i) => i.kind === 'incident' && isOpen(i));
  const maint = d.incidents.filter((i) => i.kind === 'maintenance' && isOpen(i)).sort((a, b) => (a.scheduled_for ?? '').localeCompare(b.scheduled_for ?? ''));
  return document({
    title: `${d.page.name} Status`, accent: d.page.accent, bodyClass: 'glow', refresh: 60,
    description: d.page.description || `Live status and incident history for ${d.page.name}.`,
    head: html`<link rel="alternate" type="application/rss+xml" title="${d.page.name} status" href="/p/${d.page.slug}/history.rss">`,
    body: html`${header(d)}<main class="wrap">
      <section class="hero"><h1>${d.page.name} status</h1>${d.page.description ? html`<p>${d.page.description}</p>` : ''}</section>
      ${banner(d)}
      ${open.length ? html`<section class="section" aria-labelledby="h-open"><h2 id="h-open">Ongoing incidents</h2>${open.map((i) => incidentCard(d, i))}</section>` : ''}
      ${maint.length ? html`<section class="section" aria-labelledby="h-maint"><h2 id="h-maint">Maintenance</h2>${maint.map((i) => incidentCard(d, i))}</section>` : ''}
      <section class="section" aria-labelledby="h-svc"><h2 id="h-svc">Services</h2>${services(d, uptime)}</section>
      <section class="section" aria-labelledby="h-past"><div class="section-head"><h2 id="h-past">Past incidents</h2><a class="small" href="/p/${d.page.slug}/history">Full history →</a></div>${pastByDay(d, 7)}</section>
      ${subscribe(d, origin)}
    </main>${footer(d)}`,
  });
}

export function incidentPage(d: PageData, id: string): Response | null {
  const i = d.incidents.find((x) => x.id === id);
  if (!i) return null;
  return document({
    title: `${i.name} · ${d.page.name} Status`, accent: d.page.accent, bodyClass: 'glow', description: plain(d.updates.filter((u) => u.incident_id === id).sort((a, b) => b.created_at.localeCompare(a.created_at))[0]?.body ?? '').slice(0, 160),
    body: html`${header(d)}<main class="wrap" style="padding-top:20px"><p><a href="/p/${d.page.slug}">← ${d.page.name} status</a></p>${incidentCard(d, i, { full: true })}</main>${footer(d)}`,
  });
}

export function historyPage(d: PageData): Response {
  const tz = d.page.time_zone;
  const items = d.incidents.filter((i) => !isOpen(i) || i.kind === 'incident').sort((a, b) => b.started_at.localeCompare(a.started_at));
  const months = new Map<string, IncidentRow[]>();
  for (const i of items) { const m = when(i.started_at, tz, { month: 'long', year: 'numeric' }); months.set(m, [...(months.get(m) ?? []), i]); }
  return document({
    title: `History · ${d.page.name} Status`, accent: d.page.accent, bodyClass: 'glow',
    body: html`${header(d)}<main class="wrap"><section class="hero"><h1>Incident history</h1><p>Everything reported on ${d.page.name}'s status page.</p></section>
      ${months.size ? [...months].map(([m, list]) => html`<section class="section"><h2>${m}</h2><div class="card">${list.map((i) => html`<div class="history-day">
        <a href="/p/${d.page.slug}/incidents/${i.id}" style="font-weight:700">${i.name}</a> <span class="pill s-${i.status}" style="margin-left:6px">${LABEL[i.status]}</span>
        <div class="small muted">${when(i.started_at, tz)}${i.resolved_at ? ` · lasted ${duration(i.started_at, i.resolved_at)}` : ''}${i.kind === 'maintenance' ? ' · maintenance' : ''}</div></div>`)}</div></section>`)
        : html`<div class="card" style="padding:22px"><p class="empty" style="margin:0">Nothing yet. That's a good thing.</p></div>`}
    </main>${footer(d)}`,
  });
}

// ---------- feeds and the badge ----------

const xml = (s: unknown) => esc(s);

export function feed(d: PageData, origin: string, kind: 'rss' | 'atom'): Response {
  const base = `${origin}/p/${d.page.slug}`;
  const items = d.incidents.slice(0, 50).map((i) => {
    const ups = d.updates.filter((u) => u.incident_id === i.id).sort((a, b) => b.created_at.localeCompare(a.created_at));
    const text = ups.map((u) => `<p><strong>${xml(LABEL[u.status] ?? u.status)}</strong> (${xml(when(u.created_at, d.page.time_zone))}) – ${markdown(u.body)}</p>`).join('');
    return { i, link: `${base}/incidents/${i.id}`, text };
  });
  if (kind === 'rss') {
    const body = `<?xml version="1.0" encoding="UTF-8"?><rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom"><channel>
<title>${xml(d.page.name)} status</title><link>${base}</link><description>Incidents and maintenance for ${xml(d.page.name)}</description>
<atom:link href="${base}/history.rss" rel="self" type="application/rss+xml"/>
${items.map(({ i, link, text }) => `<item><title>${xml(i.name)}</title><link>${link}</link><guid isPermaLink="true">${link}</guid><pubDate>${new Date(i.created_at).toUTCString()}</pubDate><description>${xml(text)}</description></item>`).join('\n')}
</channel></rss>`;
    return new Response(body, { headers: { 'content-type': 'application/rss+xml; charset=utf-8', 'cache-control': 'max-age=60' } });
  }
  const body = `<?xml version="1.0" encoding="UTF-8"?><feed xmlns="http://www.w3.org/2005/Atom">
<title>${xml(d.page.name)} status</title><id>${base}</id><link href="${base}"/><link rel="self" href="${base}/history.atom"/><updated>${d.page.updated_at}</updated>
${items.map(({ i, link, text }) => `<entry><title>${xml(i.name)}</title><id>${link}</id><link href="${link}"/><published>${i.created_at}</published><updated>${i.updated_at}</updated><content type="html">${xml(text)}</content></entry>`).join('\n')}
</feed>`;
  return new Response(body, { headers: { 'content-type': 'application/atom+xml; charset=utf-8', 'cache-control': 'max-age=60' } });
}

const BADGE: Record<string, [string, string]> = { none: ['operational', '#22c55e'], minor: ['degraded', '#eab308'], major: ['partial outage', '#f97316'], critical: ['major outage', '#ef4444'], maintenance: ['maintenance', '#38bdf8'] };
export function badge(d: PageData): Response {
  const s = indicator(d.components, d.incidents);
  const [text, color] = BADGE[s.indicator] ?? BADGE.none!;
  const left = 'status'; const lw = 6 * left.length + 14; const rw = Math.round(6.4 * text.length) + 22;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${lw + rw}" height="20" role="img" aria-label="${left}: ${text}"><title>${xml(d.page.name)}: ${text}</title>
<linearGradient id="g" x2="0" y2="100%"><stop offset="0" stop-color="#fff" stop-opacity=".1"/><stop offset="1" stop-opacity=".1"/></linearGradient>
<clipPath id="r"><rect width="${lw + rw}" height="20" rx="4"/></clipPath><g clip-path="url(#r)"><rect width="${lw}" height="20" fill="#2b2f45"/><rect x="${lw}" width="${rw}" height="20" fill="${color}"/><rect width="${lw + rw}" height="20" fill="url(#g)"/></g>
<g fill="#fff" font-family="Verdana,DejaVu Sans,sans-serif" font-size="11"><text x="7" y="14">${left}</text><circle cx="${lw + 9}" cy="10" r="3" fill="#fff"/><text x="${lw + 16}" y="14">${text}</text></g></svg>`;
  return new Response(svg, { headers: { 'content-type': 'image/svg+xml; charset=utf-8', 'cache-control': 'max-age=60', 'access-control-allow-origin': '*' } });
}

export function home(pages: Array<{ slug: string; name: string; accent: string; logo_text: string | null }>): Response {
  return document({
    title: 'Pulsar · Status pages that feel alive', bodyClass: 'glow', description: 'Beautiful, fast status pages with incidents, maintenance, uptime history, feeds, webhooks and a compatible API.',
    body: html`<header class="site-head"><div class="wrap"><a class="logo" href="/"><span class="mark" aria-hidden="true">${icon('page')}</span><span>Pulsar</span></a>
      <div class="head-links"><a class="btn ghost sm" href="/admin">Sign in</a><button class="theme-toggle" type="button" data-theme-toggle aria-label="Switch light and dark">${icon('sun')}</button></div></div></header>
    <main class="wrap"><section class="hero" style="padding-top:60px;text-align:center"><h1 style="font-size:clamp(34px,6vw,58px)">Status pages that<br><span style="background:linear-gradient(90deg,var(--accent),var(--accent-2));-webkit-background-clip:text;background-clip:text;color:transparent">feel alive.</span></h1>
      <p style="margin:16px auto 0;font-size:17px">Incidents, maintenance, 90-day uptime, feeds, webhooks and a drop-in compatible API. On the edge, everywhere.</p></section>
      ${pages.length ? html`<section class="section"><h2>Pages</h2><div class="grid g2">${pages.map((p) => html`<a class="card opt" href="/p/${p.slug}" style="--accent:${/^#[0-9a-f]{6}$/i.test(p.accent) ? p.accent : '#7c5cff'}">
        <span class="mark" style="width:34px;height:34px;font-size:15px">${p.logo_text || p.name.charAt(0)}</span><div><b>${p.name}</b><span>/p/${p.slug}</span></div></a>`)}</div></section>` : ''}
    </main><footer class="site-foot"><p class="powered"><span class="dot live" aria-hidden="true"></span> Pulsar</p></footer>`,
  });
}

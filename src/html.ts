/** HTML: every value escaped; one document shell; the stylesheet and script from /assets. */
import { ICON } from './assets.ts';

export const esc = (v: unknown) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

/** A trusted fragment (already escaped). */
export class Html { constructor(public s: string) {} toString() { return this.s; } }
export const raw = (s: string) => new Html(s);
export function html(strings: TemplateStringsArray, ...values: unknown[]): Html {
  let out = '';
  strings.forEach((s, i) => {
    out += s;
    if (i < values.length) {
      const v = values[i];
      out += Array.isArray(v) ? v.map((x) => (x instanceof Html ? x.s : esc(x))).join('') : v instanceof Html ? v.s : v === false || v == null ? '' : esc(v);
    }
  });
  return new Html(out);
}
export const icon = (name: string) => raw(ICON[name] ?? '');

/** Bumped with the assets, so browsers fetch the new ones. */
export const ASSET_VERSION = '7';

export const SECURITY_HEADERS: Record<string, string> = {
  'content-security-policy': "default-src 'none'; style-src 'self' 'unsafe-inline'; script-src 'self'; img-src 'self' data:; connect-src 'self'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'",
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'strict-origin-when-cross-origin',
  'x-frame-options': 'DENY',
  'permissions-policy': 'camera=(), microphone=(), geolocation=()',
};

const ACCENT = /^#[0-9a-f]{6}$/i;
export function document(o: { title: string; body: Html; accent?: string; bodyClass?: string; refresh?: number; head?: Html; status?: number; description?: string }): Response {
  const accent = o.accent && ACCENT.test(o.accent) ? o.accent : '#7c5cff';
  const page = html`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>${o.title}</title>${o.description ? html`<meta name="description" content="${o.description}"><meta property="og:title" content="${o.title}"><meta property="og:description" content="${o.description}">` : ''}
<meta name="theme-color" content="${accent}">
<link rel="icon" href="data:image/svg+xml,${raw(encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><circle cx="16" cy="16" r="13" fill="${accent}"/><circle cx="16" cy="16" r="5" fill="#fff"/></svg>`))}">
<link rel="stylesheet" href="/assets/pulsar.css?v=${ASSET_VERSION}"><script src="/assets/pulsar.js?v=${ASSET_VERSION}" defer></script>
${o.refresh ? raw(`<meta http-equiv="refresh" content="${o.refresh}">`) : ''}${o.head ?? ''}</head>
<body class="${o.bodyClass ?? ''}" style="--accent:${accent}">${o.body}</body></html>`;
  return new Response(page.s, { status: o.status ?? 200, headers: { 'content-type': 'text/html; charset=utf-8', ...SECURITY_HEADERS } });
}

export const LABEL: Record<string, string> = {
  operational: 'Operational', degraded_performance: 'Degraded performance', partial_outage: 'Partial outage', major_outage: 'Major outage', under_maintenance: 'Under maintenance',
  investigating: 'Investigating', identified: 'Identified', monitoring: 'Monitoring', resolved: 'Resolved', postmortem: 'Postmortem',
  scheduled: 'Scheduled', in_progress: 'In progress', verifying: 'Verifying', completed: 'Completed',
  none: 'None', minor: 'Minor', major: 'Major', critical: 'Critical', maintenance: 'Maintenance',
};

/** A time in the page's zone, readable. */
const DEFAULT_WHEN: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZoneName: 'short' };
const formats = new Map<string, Intl.DateTimeFormat>();
/** One formatter per zone and style, kept (making one costs far more than using it). */
export function fmt(tz: string, opts: Intl.DateTimeFormatOptions, locale = 'en-GB') {
  const key = `${locale}|${tz}|${JSON.stringify(opts)}`;
  let f = formats.get(key);
  if (!f) { f = new Intl.DateTimeFormat(locale, { timeZone: tz, ...opts }); formats.set(key, f); }
  return f;
}
export const when = (iso: string | null | undefined, tz: string, opts: Intl.DateTimeFormatOptions = DEFAULT_WHEN) =>
  (iso ? fmt(tz, opts).format(new Date(iso)) : '');
/** The local date (YYYY-MM-DD) of a time in a zone. */
export const localDate = (iso: string, tz: string) => fmt(tz, { year: 'numeric', month: '2-digit', day: '2-digit' }, 'en-CA').format(new Date(iso));
/** A <time> the script turns into "5 min ago" (the absolute time stays as its title). */
export const ago = (iso: string | null | undefined, tz: string) => (iso ? html`<time datetime="${iso}" data-rel title="${when(iso, tz)}">${when(iso, tz)}</time>` : '');

/** How long between two times, roughly. */
export function duration(from: string, to: string | null): string {
  const m = Math.max(0, Math.round(((to ? Date.parse(to) : Date.now()) - Date.parse(from)) / 60000));
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60); const r = m % 60;
  if (h < 48) return r ? `${h} h ${r} min` : `${h} h`;
  return `${Math.round(h / 24)} days`;
}

import type { ComponentRow, IncidentRow, PageData, PageRow, UpdateRow } from './format.ts';

const ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789';
/** A 12-character id, a-z0-9, like Statuspage's. */
export function newId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(12));
  return Array.from(bytes, (b) => ALPHABET[b % ALPHABET.length]).join('');
}
export const nowIso = () => new Date().toISOString();

export async function pageBySlug(db: D1Database, slug: string): Promise<PageRow | null> {
  if (!/^[a-z0-9-]{1,40}$/.test(slug)) return null;
  return db.prepare('SELECT * FROM pages WHERE slug = ?').bind(slug).first<PageRow>();
}

/** A page with its components and its last 100 incidents (and maintenance), their updates and
 *  components: ONE round trip (each statement finds the page by its slug), and with `openOnly` just
 *  what is still open (summary/status and the API's read show nothing else). D1 bills rows read. */
export async function loadPage(db: D1Database, slug: string, opts: { openOnly?: boolean } = {}): Promise<PageData | null> {
  if (!/^[a-z0-9-]{1,40}$/.test(slug)) return null;
  const pageId = '(SELECT id FROM pages WHERE slug = ?1)';
  const open = opts.openOnly ? ` AND ((kind = 'incident' AND status NOT IN ('resolved', 'postmortem')) OR (kind = 'maintenance' AND status <> 'completed'))` : '';
  const ids = `SELECT id FROM incidents WHERE page_id = ${pageId}${open} ORDER BY created_at DESC LIMIT 100`;
  const [pages, components, incidents, updates, links] = await db.batch([
    db.prepare('SELECT * FROM pages WHERE slug = ?1').bind(slug),
    db.prepare(`SELECT * FROM components WHERE page_id = ${pageId} ORDER BY position, name`).bind(slug),
    db.prepare(`SELECT * FROM incidents WHERE page_id = ${pageId}${open} ORDER BY created_at DESC LIMIT 100`).bind(slug),
    db.prepare(`SELECT * FROM incident_updates WHERE incident_id IN (${ids}) ORDER BY created_at`).bind(slug),
    db.prepare(`SELECT incident_id, component_id FROM incident_components WHERE incident_id IN (${ids})`).bind(slug),
  ]);
  const page = (pages!.results?.[0] ?? null) as unknown as PageRow | null;
  if (!page) return null;
  return {
    page,
    components: (components!.results ?? []) as unknown as ComponentRow[],
    incidents: (incidents!.results ?? []) as unknown as IncidentRow[],
    updates: (updates!.results ?? []) as unknown as UpdateRow[],
    links: (links!.results ?? []) as unknown as Array<{ incident_id: string; component_id: string }>,
  };
}

// Building an Intl formatter is the expensive part: one per time zone, kept.
const partsFormats = new Map<string, Intl.DateTimeFormat>();
function partsFormat(tz: string) {
  let f = partsFormats.get(tz);
  if (!f) { f = new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' }); partsFormats.set(tz, f); }
  return f;
}

/** A `datetime-local` value ("2026-10-14T22:00") in a time zone, as UTC ISO; null if not a time. */
export function zonedToUtc(local: string, tz: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(local)) return null;
  const guess = new Date(`${local}:00Z`);
  // The zone's offset at that moment (twice, for a time near a DST change).
  const f = partsFormat(tz);
  const offset = (d: Date) => {
    const p = Object.fromEntries(f.formatToParts(d).map((x) => [x.type, x.value]));
    return Date.UTC(+p.year!, +p.month! - 1, +p.day!, +p.hour!, +p.minute!, +p.second!) - d.getTime();
  };
  let t = guess.getTime() - offset(guess);
  t = guess.getTime() - offset(new Date(t));
  return new Date(t).toISOString();
}

/** A UTC ISO time as a `datetime-local` value in a time zone. */
export function utcToZoned(iso: string | null, tz: string): string {
  if (!iso) return '';
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
    .formatToParts(new Date(iso)).map((x) => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`;
}

export async function audit(db: D1Database, userId: string | null, action: string, detail: unknown) {
  await db.prepare('INSERT INTO audit (at, user_id, action, detail) VALUES (?, ?, ?, ?)').bind(nowIso(), userId, action, JSON.stringify(detail)).run();
}

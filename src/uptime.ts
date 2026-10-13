/**
 * Uptime per service from its status history (component_status_log): for each of the last N days
 * in the page's time zone, the worst status it had and the minutes it was down, and the share of
 * the whole period it was up. A major outage counts in full, a partial outage at 30% (as the
 * common status pages do); degraded performance and maintenance don't count as down.
 */
import { zonedToUtc } from './db.ts';
import { localDate } from './html.ts';

export interface DayBar { date: string; worst: string; downMinutes: number; incidents: string[] }
export interface Uptime { percent: number; days: DayBar[] }

const WEIGHT: Record<string, number> = { major_outage: 1, partial_outage: 0.3 };
const RANK: Record<string, number> = { operational: 0, under_maintenance: 1, degraded_performance: 2, partial_outage: 3, major_outage: 4 };

/** The last `n` local dates (YYYY-MM-DD), oldest first, ending today in `tz`. */
export function lastDays(n: number, tz: string, now = new Date()): string[] {
  const today = localDate(now.toISOString(), tz);
  const [y, m, d] = today.split('-').map(Number);
  return Array.from({ length: n }, (_, i) => {
    const t = new Date(Date.UTC(y!, m! - 1, d! - (n - 1 - i)));
    return t.toISOString().slice(0, 10);
  });
}

export function computeUptime(
  log: Array<{ status: string; at: string }>, createdAt: string, tz: string, n: number,
  incidentsByDay: Map<string, string[]> = new Map(), now = new Date(),
): Uptime {
  const days = lastDays(n, tz, now);
  const sorted = [...log].sort((a, b) => a.at.localeCompare(b.at)).map((e) => ({ status: e.status, t: Date.parse(e.at) }));
  const startOf = dayStarts(days, tz);
  const start = (date: string) => startOf.get(date)!;
  const bars: DayBar[] = [];
  let totalDown = 0; let totalSpan = 0;
  for (let k = 0; k < days.length; k++) {
    const date = days[k]!;
    const from = Math.max(start(date), Date.parse(createdAt));
    const to = Math.min(k + 1 < days.length ? start(days[k + 1]!) : now.getTime(), now.getTime());
    if (to <= from) { bars.push({ date, worst: 'none', downMinutes: 0, incidents: [] }); continue; }
    // The status at `from`, then each change within the day.
    let status = 'operational';
    for (const e of sorted) { if (e.t <= from) status = e.status; else break; }
    let worst = status; let t = from; let down = 0;
    for (const e of sorted) {
      const at = e.t;
      if (at <= from) continue;
      if (at >= to) break;
      down += (at - t) * (WEIGHT[status] ?? 0);
      status = e.status; t = at;
      if ((RANK[status] ?? 0) > (RANK[worst] ?? 0)) worst = status;
    }
    down += (to - t) * (WEIGHT[status] ?? 0);
    totalDown += down; totalSpan += to - from;
    bars.push({ date, worst, downMinutes: Math.round(down / 60000), incidents: incidentsByDay.get(date) ?? [] });
  }
  const percent = totalSpan ? Math.max(0, 100 * (1 - totalDown / totalSpan)) : 100;
  return { percent: Math.floor(percent * 100) / 100, days: bars };
}

/** Each local day's start (UTC ms), computed once per zone and day: every service shares them. */
const startCache = new Map<string, number>();
function dayStarts(days: string[], tz: string) {
  const out = new Map<string, number>();
  for (const d of days) {
    const k = `${tz}|${d}`;
    let v = startCache.get(k);
    if (v === undefined) { v = Date.parse(zonedToUtc(`${d}T00:00`, tz)!); if (startCache.size > 5000) startCache.clear(); startCache.set(k, v); }
    out.set(d, v);
  }
  return out;
}

/** Each service's status history over the last `n` days (and the status it had going in). */
export async function loadUptime(db: D1Database, pageId: string, tz: string, n = 90) {
  const since = new Date(Date.now() - (n + 1) * 86_400_000).toISOString();
  const rows = (await db.prepare(`SELECT l.component_id, l.status, l.at FROM component_status_log l JOIN components c ON c.id = l.component_id
     WHERE c.page_id = ? AND (l.at >= ? OR l.at = (SELECT max(at) FROM component_status_log x WHERE x.component_id = l.component_id AND x.at < ?)) ORDER BY l.at`)
    .bind(pageId, since, since).all<{ component_id: string; status: string; at: string }>()).results;
  const byComponent = new Map<string, Array<{ status: string; at: string }>>();
  for (const r of rows) byComponent.set(r.component_id, [...(byComponent.get(r.component_id) ?? []), { status: r.status, at: r.at }]);
  return byComponent;
}

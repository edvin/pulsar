/**
 * The public read API, in the shape of Statuspage's v2 JSON (`summary.json`, `incidents.json`,
 * `status.json`), so clients built for that format read Pulsar unchanged. Built from rows; no I/O.
 */

export interface PageRow {
  id: string; slug: string; name: string; time_zone: string; updated_at: string;
  description?: string | null; accent?: string; logo_text?: string | null; website_url?: string | null; support_url?: string | null; hide_powered_by?: number;
}
export interface ComponentRow { id: string; page_id: string; name: string; description: string | null; status: string; position: number; created_at: string; updated_at: string; group_name?: string | null; show_uptime?: number }
export interface IncidentRow {
  id: string; page_id: string; kind: 'incident' | 'maintenance'; name: string; status: string; impact: string;
  created_at: string; updated_at: string; started_at: string; monitoring_at: string | null; resolved_at: string | null;
  scheduled_for: string | null; scheduled_until: string | null; postmortem?: string | null; auto_transition?: number;
}
export interface UpdateRow { id: string; incident_id: string; status: string; body: string; created_at: string }

export const INCIDENT_STATUSES = ['investigating', 'identified', 'monitoring', 'resolved', 'postmortem'] as const;
export const MAINTENANCE_STATUSES = ['scheduled', 'in_progress', 'verifying', 'completed'] as const;
export const IMPACTS = ['none', 'minor', 'major', 'critical'] as const;
export const COMPONENT_STATUSES = ['operational', 'degraded_performance', 'partial_outage', 'major_outage', 'under_maintenance'] as const;

/** An incident still open, or a maintenance not completed. */
export const isOpen = (i: Pick<IncidentRow, 'kind' | 'status'>) =>
  i.kind === 'incident' ? !['resolved', 'postmortem'].includes(i.status) : i.status !== 'completed';

const RANK: Record<string, number> = { none: 0, minor: 1, major: 2, critical: 3 };
const COMPONENT_RANK: Record<string, number> = { operational: 0, under_maintenance: 0, degraded_performance: 1, partial_outage: 2, major_outage: 3 };
const DESCRIPTION: Record<string, string> = {
  none: 'All Systems Operational', minor: 'Minor Service Outage', major: 'Partial System Outage',
  critical: 'Major System Outage', maintenance: 'Service Under Maintenance',
};

/** The page's overall indicator: the worst of its open incidents and its components; maintenance
 *  in progress when nothing is broken. */
export function indicator(components: ComponentRow[], incidents: IncidentRow[]): { indicator: string; description: string } {
  let worst = 0;
  for (const i of incidents) if (i.kind === 'incident' && isOpen(i)) worst = Math.max(worst, RANK[i.impact] ?? 0);
  for (const c of components) worst = Math.max(worst, COMPONENT_RANK[c.status] ?? 0);
  let ind = (Object.keys(RANK).find((k) => RANK[k] === worst) ?? 'none');
  if (worst === 0 && incidents.some((i) => i.kind === 'maintenance' && ['in_progress', 'verifying'].includes(i.status))) ind = 'maintenance';
  return { indicator: ind, description: DESCRIPTION[ind]! };
}

export function pageJson(p: PageRow, origin: string) {
  return { id: p.id, name: p.name, url: `${origin}/p/${p.slug}`, time_zone: p.time_zone, updated_at: p.updated_at };
}

export function componentJson(c: ComponentRow) {
  return {
    id: c.id, name: c.name, status: c.status, created_at: c.created_at, updated_at: c.updated_at, position: c.position,
    description: c.description, showcase: true, start_date: null, group_id: null, page_id: c.page_id, group: false, only_show_if_degraded: false,
  };
}

export function incidentJson(i: IncidentRow, updates: UpdateRow[], components: ComponentRow[], origin: string, slug: string) {
  const comps = components.map(componentJson);
  const affected = components.map((c) => ({ code: c.id, name: c.name, old_status: 'operational', new_status: c.status }));
  const base = {
    id: i.id, name: i.name, status: i.status, created_at: i.created_at, updated_at: i.updated_at,
    monitoring_at: i.monitoring_at, resolved_at: i.resolved_at, impact: i.impact,
    shortlink: `${origin}/p/${slug}/incidents/${i.id}`, started_at: i.started_at, page_id: i.page_id,
    incident_updates: [...updates].sort((a, b) => b.created_at.localeCompare(a.created_at)).map((u) => ({
      id: u.id, status: u.status, body: u.body, incident_id: i.id, created_at: u.created_at, updated_at: u.created_at,
      display_at: u.created_at, affected_components: affected, deliver_notifications: true, custom_tweet: null, tweet_id: null,
    })),
    components: comps,
  };
  return i.kind === 'maintenance' ? { ...base, scheduled_for: i.scheduled_for, scheduled_until: i.scheduled_until, scheduled_remind_prior: false, scheduled_auto_in_progress: false, scheduled_auto_completed: false } : base;
}

export interface PageData { page: PageRow; components: ComponentRow[]; incidents: IncidentRow[]; updates: UpdateRow[]; links: Array<{ incident_id: string; component_id: string }> }

function build(d: PageData, origin: string, i: IncidentRow) {
  const comps = d.links.filter((l) => l.incident_id === i.id).map((l) => d.components.find((c) => c.id === l.component_id)).filter((c): c is ComponentRow => !!c);
  return incidentJson(i, d.updates.filter((u) => u.incident_id === i.id), comps, origin, d.page.slug);
}

/** GET /api/v2/summary.json: the page, its status, components, open incidents and maintenance not completed. */
export function summary(d: PageData, origin: string) {
  const incidents = d.incidents.filter((i) => i.kind === 'incident' && isOpen(i));
  const maint = d.incidents.filter((i) => i.kind === 'maintenance' && isOpen(i));
  return {
    page: pageJson(d.page, origin),
    status: indicator(d.components, d.incidents),
    components: [...d.components].sort((a, b) => a.position - b.position).map(componentJson),
    incidents: incidents.map((i) => build(d, origin, i)),
    scheduled_maintenances: maint.map((i) => build(d, origin, i)),
  };
}

/** GET /api/v2/incidents.json: the last 50 incidents, resolved ones included, newest first. */
export function incidentsList(d: PageData, origin: string) {
  return {
    page: pageJson(d.page, origin),
    incidents: d.incidents.filter((i) => i.kind === 'incident').sort((a, b) => b.created_at.localeCompare(a.created_at)).slice(0, 50).map((i) => build(d, origin, i)),
  };
}

/** GET /api/v2/scheduled-maintenances.json */
export function maintenancesList(d: PageData, origin: string) {
  return {
    page: pageJson(d.page, origin),
    scheduled_maintenances: d.incidents.filter((i) => i.kind === 'maintenance').sort((a, b) => b.created_at.localeCompare(a.created_at)).slice(0, 50).map((i) => build(d, origin, i)),
  };
}

/** GET /api/v2/status.json */
export function status(d: PageData, origin: string) {
  return { page: pageJson(d.page, origin), status: indicator(d.components, d.incidents) };
}

/**
 * Manager / org-view data contract (`/manager`, `/api/v1/org/*`).
 *
 * The deployed page scopes every number server-side: the same usage and chart
 * responses change with the selected range and with the optional `root=`
 * person/team slug. A non-manager opening the page gets `scope: "self"` and
 * the dashboard endpoints; that path is handled separately.
 */
import { gatewayUrl } from './gateway'
import type { Overview } from './dashboard'

export type ManagerScope = 'self' | 'manager' | 'admin'

export interface OrgScope {
  username: string
  scope: ManagerScope
  isAdmin: boolean
  isSuperAdmin: boolean
  isManager: boolean
  scopeSize: number
  roots: unknown[]
  personSlug: string
}

export interface OrgUsageRow {
  slug: string
  full_name: string
  username: string
  is_manager: boolean
  manager_slug?: string
  requests: number
  total_tokens: number
  cost_usd: number
  last_used?: string
  quota_exempt: boolean
  quota_enforced: boolean
  quota_usd: number
  quota_spent_usd: number
  over_limit: boolean
}

export interface OrgModel {
  model: string
  provider: string
  hosted?: boolean
  requests: number
  prompt_tokens: number
  completion_tokens: number
  cached_tokens?: number
  cached_input_tokens?: number
  total_tokens: number
  cost_usd: number
  saved_usd: number
}

export interface OrgUser {
  username: string
  user_id?: string
  tags?: Record<string, string>
  display_name?: string
  group_name?: string
  requests: number
  total_tokens: number
  cost_usd: number
  saved_usd: number
}

export interface TimelinePoint {
  bucket: string
  series: string
  total_tokens: number
  total_cost_usd: number
  requests: number
}

export interface OrgCharts {
  overview: Overview
  models: OrgModel[]
  users: OrgUser[]
  timeline: TimelinePoint[]
}

export interface PersonModel {
  model: string
  provider: string
  hosted?: boolean
  requests: number
  prompt_tokens: number
  completion_tokens: number
  cached_tokens: number
  total_tokens: number
  cost_usd: number
  saved_usd: number
  last_used?: string
}

export interface PersonDetail {
  full_name: string
  usernames: string[]
  models: PersonModel[]
}

/* ── formatting (deployed manager.html parity) ───────────────────────── */

export function fmtMoney(value: number | null | undefined): string {
  return `$${Number(value || 0).toLocaleString(undefined, { maximumFractionDigits: 2 })}`
}

export function fmtTokens(value: number | null | undefined): string {
  const v = Number(value || 0)
  if (v >= 1e9) return `${(v / 1e9).toFixed(2)}B`
  if (v >= 1e6) return `${(v / 1e6).toFixed(2)}M`
  if (v >= 1e3) return `${(v / 1e3).toFixed(1)}K`
  return String(v)
}

export type PieMetric = 'cost' | 'tokens' | 'requests'

export function pieValue(
  row: { cost_usd: number; total_tokens: number; requests: number },
  metric: PieMetric,
): number {
  if (metric === 'cost') return row.cost_usd
  if (metric === 'tokens') return row.total_tokens
  return row.requests
}

export function pieFormat(value: number, metric: PieMetric): string {
  return metric === 'cost' ? fmtMoney(value) : fmtTokens(value)
}

export function isHosted(row: { hosted?: boolean; provider: string; cost_usd: number }): boolean {
  return (
    row.hosted === true ||
    ['vllm', 'qwen'].includes(row.provider || '') ||
    (row.cost_usd || 0) === 0
  )
}

export function lastUsedLabel(value?: string): string {
  if (!value) return 'never'
  const date = new Date(value)
  return Number.isFinite(date.getTime()) ? date.toISOString().slice(0, 10) : 'never'
}

/* ── transport / parsing ─────────────────────────────────────────────── */

type UnknownRecord = Record<string, unknown>

function asRecord(value: unknown): UnknownRecord {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('unexpected manager payload')
  }
  return value as UnknownRecord
}

function asArray(value: unknown): unknown[] {
  if (!Array.isArray(value)) throw new Error('unexpected manager payload')
  return value
}

const num = (value: unknown) => (typeof value === 'number' && Number.isFinite(value) ? value : 0)
const str = (value: unknown) => (typeof value === 'string' ? value : '')

async function getJson(path: string, signal?: AbortSignal): Promise<unknown> {
  const res = await fetch(gatewayUrl(path), {
    cache: 'no-store',
    credentials: 'same-origin',
    headers: { Accept: 'application/json' },
    signal,
  })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.json()
}

function parseOverview(value: unknown): Overview {
  const d = asRecord(value)
  return {
    total_requests: num(d.total_requests),
    total_prompt_tokens: num(d.total_prompt_tokens),
    total_completion_tokens: num(d.total_completion_tokens),
    total_tokens: num(d.total_tokens),
    active_users: num(d.active_users),
    total_cost_usd: num(d.total_cost_usd),
    saved_usd: typeof d.saved_usd === 'number' && Number.isFinite(d.saved_usd) ? d.saved_usd : null,
    savings_ratio: num(d.savings_ratio),
    savings_ratio_applied: d.savings_ratio_applied === true,
  }
}

function parseModels(value: unknown): OrgModel[] {
  return asArray(value)
    .map((entry) => {
      const d = asRecord(entry)
      return {
        model: str(d.model),
        provider: str(d.provider),
        hosted: typeof d.hosted === 'boolean' ? d.hosted : undefined,
        requests: num(d.requests),
        prompt_tokens: num(d.prompt_tokens),
        completion_tokens: num(d.completion_tokens),
        cached_tokens: num(d.cached_tokens ?? d.cached_input_tokens),
        cached_input_tokens: num(d.cached_input_tokens),
        total_tokens: num(d.total_tokens),
        cost_usd: num(d.cost_usd),
        saved_usd: num(d.saved_usd),
      }
    })
    .filter((row) => row.model !== '')
}

function parseTags(value: unknown): Record<string, string> | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined
  const tags: Record<string, string> = {}
  for (const [key, entry] of Object.entries(value)) {
    if (typeof entry === 'string') tags[key] = entry
  }
  return tags
}

function parseUsers(value: unknown): OrgUser[] {
  return asArray(value)
    .map((entry) => {
      const d = asRecord(entry)
      return {
        username: str(d.username),
        user_id: str(d.user_id),
        tags: parseTags(d.tags),
        display_name: str(d.display_name),
        group_name: str(d.group_name),
        requests: num(d.requests),
        total_tokens: num(d.total_tokens),
        cost_usd: num(d.cost_usd),
        saved_usd: num(d.saved_usd),
      }
    })
    .filter((row) => row.username !== '')
}

function parseTimeline(value: unknown): TimelinePoint[] {
  return asArray(value).map((entry) => {
    const d = asRecord(entry)
    return {
      bucket: str(d.bucket),
      series: str(d.series),
      total_tokens: num(d.total_tokens),
      total_cost_usd: num(d.total_cost_usd),
      requests: num(d.requests),
    }
  })
}

function parseCharts(value: unknown): OrgCharts {
  const d = asRecord(value)
  return {
    overview: parseOverview(d.overview),
    models: parseModels(d.models),
    users: parseUsers(d.users),
    timeline: parseTimeline(d.timeline),
  }
}

export async function fetchScope(signal?: AbortSignal): Promise<OrgScope> {
  const d = asRecord(await getJson('api/v1/org/scope', signal))
  const scope = str(d.scope)
  if (scope !== 'self' && scope !== 'manager' && scope !== 'admin') {
    throw new Error('unknown org scope')
  }
  return {
    username: str(d.username),
    scope,
    isAdmin: d.isAdmin === true,
    isSuperAdmin: d.isSuperAdmin === true,
    isManager: d.isManager === true,
    scopeSize: num(d.scopeSize),
    roots: asArray(d.roots ?? []),
    personSlug: str(d.personSlug),
  }
}

export async function fetchUsage(
  range: string,
  root: string,
  signal?: AbortSignal,
): Promise<OrgUsageRow[]> {
  const params = [`range=${encodeURIComponent(range)}`]
  if (root) params.push(`root=${encodeURIComponent(root)}`)
  const payload = await getJson(`api/v1/org/usage?${params.join('&')}`, signal)
  // Standalone deployments return a bare row array; cluster deployments wrap
  // the rows in a {rows, totals} envelope (the totals stay inclusive when the
  // country policy hides people from the table). Accept both shapes and keep
  // deriving the page numbers from the rows, matching the standalone contract.
  const rows = Array.isArray(payload)
    ? payload
    : asArray(asRecord(payload).rows ?? [])
  return rows.map((entry) => {
    const d = asRecord(entry)
    return {
      slug: str(d.slug),
      full_name: str(d.full_name),
      username: str(d.username),
      is_manager: d.is_manager === true,
      manager_slug: str(d.manager_slug),
      requests: num(d.requests),
      total_tokens: num(d.total_tokens),
      cost_usd: num(d.cost_usd),
      last_used: str(d.last_used) || undefined,
      quota_exempt: d.quota_exempt === true,
      quota_enforced: d.quota_enforced === true,
      quota_usd: num(d.quota_usd),
      quota_spent_usd: num(d.quota_spent_usd),
      over_limit: d.over_limit === true,
    }
  })
}

export async function fetchCharts(
  range: string,
  root: string,
  savingsRef: string,
  signal?: AbortSignal,
): Promise<OrgCharts> {
  const params = [
    `range=${encodeURIComponent(range)}`,
    `ref=${encodeURIComponent(savingsRef)}`,
  ]
  if (root) params.push(`root=${encodeURIComponent(root)}`)
  return parseCharts(await getJson(`api/v1/org/charts?${params.join('&')}`, signal))
}

export async function fetchPerson(
  slug: string,
  range: string,
  signal?: AbortSignal,
): Promise<PersonDetail> {
  const d = asRecord(
    await getJson(
      `api/v1/org/person?slug=${encodeURIComponent(slug)}&range=${encodeURIComponent(range)}`,
      signal,
    ),
  )
  return {
    full_name: str(d.full_name),
    usernames: asArray(d.usernames ?? []).filter((u): u is string => typeof u === 'string'),
    models: asArray(d.models ?? []).map((entry) => {
      const m = asRecord(entry)
      return {
        model: str(m.model),
        provider: str(m.provider),
        hosted: typeof m.hosted === 'boolean' ? m.hosted : undefined,
        requests: num(m.requests),
        prompt_tokens: num(m.prompt_tokens),
        completion_tokens: num(m.completion_tokens),
        cached_tokens: num(m.cached_tokens),
        total_tokens: num(m.total_tokens),
        cost_usd: num(m.cost_usd),
        saved_usd: num(m.saved_usd),
        last_used: str(m.last_used) || undefined,
      }
    }),
  }
}

/** Self scope uses the dashboard's self-scoped endpoints. */
export async function fetchSelfCharts(
  range: string,
  savingsRef: string,
  signal?: AbortSignal,
): Promise<OrgCharts> {
  const q = `range=${encodeURIComponent(range)}`
  const [overview, models, users, timeline] = await Promise.all([
    getJson(`api/v1/dashboard/overview?${q}&ref=${encodeURIComponent(savingsRef)}`, signal),
    getJson(`api/v1/dashboard/models?${q}`, signal),
    getJson(`api/v1/dashboard/users?${q}&sort=cost_usd&order=desc&limit=10`, signal),
    getJson(`api/v1/dashboard/timeline?${q}&group_by=user`, signal),
  ])
  return {
    overview: parseOverview(overview),
    models: parseModels(models),
    users: parseUsers(users),
    timeline: parseTimeline(timeline),
  }
}

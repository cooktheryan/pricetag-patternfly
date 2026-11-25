/**
 * Dashboard data contract — the usage page's slice of the gateway API.
 *
 * The shapes mirror the live UI (dashboard.html at the deployed gateway),
 * not the newer source tree: the live page has no geography or cost-center
 * charts, and Recent Activity has twelve columns. Responses are parsed
 * defensively so a partial payload renders as zeros/empty rather than
 * crashing the page; a non-object payload is a contract failure and is
 * surfaced through the page's retry state.
 */
import { gatewayUrl } from './gateway'

export type RangePreset = '24h' | '7d' | '30d' | 'mtd' | 'custom'
export type PieMetric = 'cost' | 'tokens' | 'requests'
export type ToolMetric = 'tokens' | 'requests' | 'users'
export type UserMetric = 'cost' | 'tokens' | 'requests'

export interface DashboardFilters {
  range: RangePreset
  customFrom: string
  customTo: string
  modelFilter: string
  userFilter: string[]
}

export interface Overview {
  total_requests: number
  total_prompt_tokens: number
  total_completion_tokens: number
  total_tokens: number
  active_users: number
  total_cost_usd: number
  /** Server-computed saved amount; null when the gateway omits it. */
  saved_usd: number | null
  savings_ratio: number
  savings_ratio_applied: boolean
}

export interface ModelRow {
  model: string
  provider: string
  requests: number
  total_tokens: number
  prompt_tokens: number
  completion_tokens: number
  cached_input_tokens: number
  cache_creation_tokens: number
  cost_usd: number
  hosted?: boolean
  input_price_per_mtok: number
  output_price_per_mtok: number
  cache_read_price_per_mtok: number
  cache_write_price_per_mtok: number
}

export interface ToolRow {
  tool: string
  requests: number
  users: number
  total_tokens: number
  cost_usd: number
}

export interface RecentRow {
  timestamp: string
  username: string
  display_name: string
  country: string
  group_name: string
  model: string
  provider: string
  prompt_tokens: number
  completion_tokens: number
  total_tokens: number
  cached_input_tokens: number
  cache_creation_tokens: number
  cost_usd: number
  user_agent: string
  /** null = recorded before the column existed; 0 = no upstream response. */
  status_code: number | null
}

export interface UserRow {
  username: string
  user_id: string
  tags: Record<string, string>
  display_name: string
  group_name: string
  requests: number
  prompt_tokens: number
  completion_tokens: number
  total_tokens: number
  cost_usd: number
  saved_usd: number
}

export interface DirectoryUser {
  username: string
  user_id: string
  tags: Record<string, string>
  display_name: string
  group_name: string
}

export interface DashboardData {
  overview: Overview
  /** Filtered usage rows (top 10 by the current user-chart metric). */
  chartUsers: UserRow[]
  models: ModelRow[]
  tools: ToolRow[]
  recent: RecentRow[]
  /** Range-only roster merged with the directory, for the user filter. */
  rosterUsers: UserRow[]
  /** Range-only model stats, the basis for the hosted-vs-vendor split. */
  catalogModels: ModelRow[]
  directoryUsers: DirectoryUser[]
}

/* ── formatting (legacy dashboard.html parity) ───────────────────────── */

export function fmtN(value: number | null | undefined): string {
  const n = Number(value) || 0
  if (n >= 1e9) return `${(n / 1e9).toFixed(1)}B`
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`
  if (n >= 1e3) return `${(n / 1e3).toFixed(1)}K`
  return String(n)
}

export function fmtC(value: number | null | undefined): string {
  if (value == null) return '$0.00'
  const n = Number(value) || 0
  if (n !== 0 && Math.abs(n) < 0.01) return `$${n.toFixed(4)}`
  return `$${n.toFixed(2)}`
}

/** Quota amounts use thousands separators, unlike the KPI currency format. */
export function qfmt(value: number | null | undefined): string {
  return `$${(Number(value) || 0).toLocaleString(undefined, { maximumFractionDigits: 2 })}`
}

export function timeAgo(timestamp: string, now = Date.now()): string {
  const then = new Date(timestamp).getTime()
  if (!Number.isFinite(then)) return '—'
  // Clamp future timestamps (clock skew) instead of rendering "-5s ago".
  const s = Math.max(0, Math.floor((now - then) / 1000))
  if (s < 60) return `${s}s ago`
  if (s < 3600) return `${Math.floor(s / 60)}m ago`
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`
  return `${Math.floor(s / 86400)}d ago`
}

/** Normalise a user-agent into the client names the old dashboard shows. */
export function friendlyClient(ua: string): string {
  if (!ua) return ''
  const normalized = ua.toLowerCase()
  if (normalized.startsWith('claude-cli') || normalized.startsWith('claude-code')) return 'Claude Code'
  if (normalized.startsWith('codex-tui') || normalized.startsWith('codex/')) return 'Codex'
  if (
    normalized === 'opencode' ||
    normalized.startsWith('opencode/') ||
    normalized.startsWith('opencode-') ||
    normalized.startsWith('opencode.')
  ) {
    return 'OpenCode'
  }
  if (
    normalized === 'pi' ||
    normalized.startsWith('pi/') ||
    normalized.startsWith('pi-') ||
    normalized.startsWith('pi.') ||
    normalized.startsWith('pi ')
  ) {
    return 'Pi'
  }
  if (normalized.startsWith('charm-crush/')) return 'Charm-Crush'
  if (normalized.startsWith('openai/')) return 'OpenAI'
  if (normalized.startsWith('omp/')) return 'omp'
  if (normalized.startsWith('curl/')) return 'curl'
  return 'Other'
}

const TOOL_COLORS: Record<string, string> = {
  'Claude Code': '#d29922',
  Codex: '#3fb950',
  OpenCode: '#58a6ff',
  Pi: '#bc8cff',
  curl: '#8b949e',
  Other: '#39d2c0',
}

export function toolColor(tool: string): string {
  return TOOL_COLORS[tool] || '#39d2c0'
}

export interface StatusCell {
  text: string
  tone: 'ok' | 'error' | 'unknown'
  title: string
}

/** Map an HTTP status to the legacy colored cell. */
export function statusCell(code: number | null): StatusCell {
  if (code === null || code === undefined) {
    return { text: '—', tone: 'unknown', title: 'unknown (recorded before status tracking)' }
  }
  if (code === 0) return { text: 'ERR', tone: 'error', title: 'no upstream response' }
  const ok = code >= 200 && code < 300
  return {
    text: String(code),
    tone: ok ? 'ok' : 'error',
    title: ok ? 'success' : 'error response',
  }
}

/** Two-letter country code -> flag emoji ('' when the code is unusable). */
export function countryFlag(code: string): string {
  const normalized = String(code || '').trim().toUpperCase()
  if (!/^[A-Z]{2}$/.test(normalized)) return ''
  return [...normalized].map((c) => String.fromCodePoint(127397 + c.charCodeAt(0))).join('')
}

/** Local YYYY-MM-DD — never rolls across a boundary for non-UTC viewers. */
export function dstr(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

/** Date-input values for a preset, matching the legacy syncDateInputs(). */
export function rangeBounds(range: RangePreset, now = new Date()): { from: string; to: string } {
  const from = new Date(now)
  if (range === '24h') from.setDate(from.getDate() - 1)
  else if (range === '7d') from.setDate(from.getDate() - 7)
  else if (range === '30d') from.setDate(from.getDate() - 30)
  else from.setDate(1)
  return { from: dstr(from), to: dstr(now) }
}

/* ── chart helpers ───────────────────────────────────────────────────── */

/** One categorical palette for every pie, same hues as the old UI. */
export const COLORS = [
  '#58a6ff',
  '#3fb950',
  '#d29922',
  '#f85149',
  '#bc8cff',
  '#39d2c0',
  '#f778ba',
  '#79c0ff',
  '#7ee787',
  '#e3b341',
  '#ff9a8c',
  '#d2a8ff',
  '#56d4dd',
  '#ffa657',
  '#a5d6ff',
]

export const OTHER_SLICE_COLOR = '#5b6b82'

export interface PieDatum {
  item: ModelRow | UserRow | null
  label: string
  value: number
}

export function pieVal(row: ModelRow | UserRow, metric: PieMetric): number {
  if (metric === 'cost') return row.cost_usd
  if (metric === 'tokens') return row.total_tokens
  return row.requests
}

export function pieFmt(value: number, metric: PieMetric): string {
  return metric === 'cost' ? fmtC(value) : fmtN(value)
}

/** Top N items plus an aggregated "Other" bucket when items remain. */
export function topFiveItems<T>(
  items: T[],
  valueFn: (item: T) => number,
  labelFn: (item: T) => string,
  limit = 5,
): { item: T | null; label: string; value: number }[] {
  const sorted = items.slice().sort((a, b) => valueFn(b) - valueFn(a))
  const top = sorted.slice(0, limit)
  const rest = sorted.slice(limit)
  const other = rest.reduce((sum, item) => sum + valueFn(item), 0)
  const result: { item: T | null; label: string; value: number }[] = top.map((item) => ({
    item,
    label: labelFn(item),
    value: valueFn(item),
  }))
  if (rest.length) result.push({ item: null, label: 'Other', value: other })
  return result
}

const HOSTED_PROVIDERS = ['vllm', 'qwen']

/**
 * Hosted = served by us. The deployed page checks the explicit flag, then
 * the provider, then falls back to a zero recorded cost (the old signal for
 * a model with no vendor pricing). All three checks are the live contract
 * (`isHostedModel` in dashboard.html); dropping the cost fallback would
 * move unpriced hosted traffic into Vendor and change the pie.
 */
export function isHostedModel(model: ModelRow): boolean {
  return model.hosted === true || HOSTED_PROVIDERS.includes(model.provider) || (model.cost_usd || 0) === 0
}

/** Reference rates used only to order the savings comparison selector. */
const MODEL_PRICING: Record<string, { input: number; output: number }> = {
  'claude-opus-5': { input: 5, output: 25 },
  'claude-fable-5': { input: 10, output: 50 },
  'claude-opus-4-8': { input: 5, output: 25 },
  'claude-opus-4-6': { input: 5, output: 25 },
  'claude-sonnet-4-6': { input: 3, output: 15 },
  'claude-sonnet-4-20250514': { input: 3, output: 15 },
  'claude-haiku-4-5': { input: 1, output: 5 },
  'claude-haiku-4-5-20251001': { input: 1, output: 5 },
  'gpt-5.5': { input: 5, output: 30 },
  'gpt-5.4': { input: 2.5, output: 15 },
  'gpt-5.4-mini': { input: 0.3, output: 1.2 },
  'gpt-5.3-codex': { input: 1.5, output: 6 },
  'gpt-4o': { input: 2.5, output: 10 },
}

const SAVINGS_REF_MODELS = [
  'claude-opus-5',
  'claude-fable-5',
  'claude-opus-4-8',
  'claude-sonnet-4-6',
  'claude-haiku-4-5',
  'gpt-5.5',
  'gpt-5.4',
  'gpt-4o',
]

/** Most expensive reference first, tie-broken alphabetically. */
export const SAVINGS_REF_OPTIONS = SAVINGS_REF_MODELS.slice().sort((a, b) => {
  const pa = MODEL_PRICING[a] || { input: 0, output: 0 }
  const pb = MODEL_PRICING[b] || { input: 0, output: 0 }
  const diff = pb.input + pb.output - (pa.input + pa.output)
  return diff !== 0 ? diff : a.localeCompare(b)
})

/* ── roster merging ──────────────────────────────────────────────────── */

/** Collapse multiple logins of one identity into a single usage row. */
export function collapseUsageUsers(rows: UserRow[]): UserRow[] {
  const byKey = new Map<string, UserRow & { usernames: string[] }>()
  rows.forEach((row) => {
    const key = row.user_id || row.username
    const existing = byKey.get(key)
    if (!existing) {
      byKey.set(key, { ...row, usernames: [row.username], tags: { ...row.tags } })
      return
    }
    existing.requests += row.requests
    existing.prompt_tokens += row.prompt_tokens
    existing.completion_tokens += row.completion_tokens
    existing.total_tokens += row.total_tokens
    existing.cost_usd += row.cost_usd
    existing.saved_usd += row.saved_usd
    if (!existing.display_name) existing.display_name = row.display_name
    if (!existing.usernames.includes(row.username)) existing.usernames.push(row.username)
    existing.tags = { ...existing.tags, ...row.tags }
  })
  return Array.from(byKey.values())
}

/**
 * Merge usage rows with the complete directory roster so users with no
 * recent usage (or beyond the usage query's cap) stay selectable.
 */
export function mergeDirectoryUsers(
  usage: UserRow[],
  directory: DirectoryUser[],
  includeDirectory: boolean,
): UserRow[] {
  const merged: UserRow[] = []
  const byUsername = new Map<string, UserRow>()
  const byUserId = new Map<string, UserRow>()
  const index = (entry: UserRow) => {
    if (entry.username && !byUsername.has(entry.username)) byUsername.set(entry.username, entry)
    if (entry.user_id && !byUserId.has(entry.user_id)) byUserId.set(entry.user_id, entry)
  }
  usage.forEach((row) => {
    merged.push(row)
    index(row)
  })
  if (!includeDirectory) return merged
  directory.forEach((entry) => {
    if (!entry.username) return
    const existing = (entry.user_id && byUserId.get(entry.user_id)) || byUsername.get(entry.username)
    if (existing) {
      existing.user_id = entry.user_id || existing.user_id
      existing.tags = { ...entry.tags, ...existing.tags }
      return
    }
    const row: UserRow = {
      username: entry.username,
      user_id: entry.user_id,
      tags: { ...entry.tags },
      display_name: entry.display_name,
      group_name: entry.group_name,
      requests: 0,
      prompt_tokens: 0,
      completion_tokens: 0,
      total_tokens: 0,
      cost_usd: 0,
      saved_usd: 0,
    }
    merged.push(row)
    index(row)
  })
  return merged
}

/* ── query building ──────────────────────────────────────────────────── */

/** Build the range query component(s) without embedding separators. */
function rangeParts(filters: DashboardFilters): string[] {
  if (filters.range !== 'custom') return [`range=${filters.range}`]
  // Match the deployed page: while a date is being edited the preset stays
  // "custom" and the request carries no bounds; once both ends are set it
  // sends both. Never silently substitute a different preset.
  const parts = ['range=custom']
  if (filters.customFrom && filters.customTo) {
    parts.push(`from=${encodeURIComponent(filters.customFrom)}`)
    parts.push(`to=${encodeURIComponent(filters.customTo)}`)
  }
  return parts
}

export function filterQuery(filters: DashboardFilters): string {
  const parts = rangeParts(filters)
  if (filters.userFilter.length) parts.push(`user=${encodeURIComponent(filters.userFilter.join(','))}`)
  if (filters.modelFilter) parts.push(`model=${encodeURIComponent(filters.modelFilter)}`)
  return parts.join('&')
}

function recentQuery(filters: DashboardFilters): string {
  // The gateway's /recent handler is a live tail: HandleRecent reads only
  // limit, group, user, and model (internal/handler/dashboard.go), so the
  // range bounds below are inert today. They are included so the request
  // describes the same window as the rest of the round and will keep working
  // if the handler ever starts filtering by time.
  const range = filters.range === 'custom' ? 'custom' : filters.range
  const parts = [`range=${range}`, 'limit=20']
  if (filters.range === 'custom' && filters.customFrom && filters.customTo) {
    parts.push(`from=${encodeURIComponent(filters.customFrom)}`)
    parts.push(`to=${encodeURIComponent(filters.customTo)}`)
  }
  if (filters.userFilter.length) parts.push(`user=${encodeURIComponent(filters.userFilter.join(','))}`)
  if (filters.modelFilter) parts.push(`model=${encodeURIComponent(filters.modelFilter)}`)
  return parts.join('&')
}

export function chartSortFor(metric: UserMetric): string {
  if (metric === 'cost') return 'cost_usd'
  if (metric === 'requests') return 'requests'
  return 'total_tokens'
}

/* ── transport ───────────────────────────────────────────────────────── */

async function getJson(path: string, fresh: boolean, signal?: AbortSignal): Promise<unknown> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 30_000)
  const abortFromParent = () => controller.abort()
  if (signal?.aborted) controller.abort()
  else signal?.addEventListener('abort', abortFromParent, { once: true })
  try {
    const headers: Record<string, string> = { Accept: 'application/json' }
    if (fresh) headers['Cache-Control'] = 'no-cache'
    const res = await fetch(gatewayUrl(path), {
      cache: 'no-store',
      credentials: 'same-origin',
      headers,
      signal: controller.signal,
    })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    return await res.json()
  } finally {
    clearTimeout(timer)
    signal?.removeEventListener('abort', abortFromParent)
  }
}

/* ── payload parsing ─────────────────────────────────────────────────── */

type UnknownRecord = Record<string, unknown>

function asRecord(value: unknown): UnknownRecord {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('unexpected dashboard payload')
  }
  return value as UnknownRecord
}

function asArray(value: unknown): unknown[] {
  if (!Array.isArray(value)) throw new Error('unexpected dashboard payload')
  return value
}

function num(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

function str(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function parseTags(value: unknown): Record<string, string> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return {}
  const tags: Record<string, string> = {}
  Object.entries(value as UnknownRecord).forEach(([key, entry]) => {
    if (typeof entry === 'string') tags[key] = entry
  })
  return tags
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

function parseModels(value: unknown): ModelRow[] {
  return asArray(value)
    .map((entry) => {
      const d = asRecord(entry)
      return {
        model: str(d.model),
        provider: str(d.provider),
        requests: num(d.requests),
        total_tokens: num(d.total_tokens),
        prompt_tokens: num(d.prompt_tokens),
        completion_tokens: num(d.completion_tokens),
        cached_input_tokens: num(d.cached_input_tokens),
        cache_creation_tokens: num(d.cache_creation_tokens),
        cost_usd: num(d.cost_usd),
        hosted: typeof d.hosted === 'boolean' ? d.hosted : undefined,
        input_price_per_mtok: num(d.input_price_per_mtok),
        output_price_per_mtok: num(d.output_price_per_mtok),
        cache_read_price_per_mtok: num(d.cache_read_price_per_mtok),
        cache_write_price_per_mtok: num(d.cache_write_price_per_mtok),
      }
    })
    .filter((row) => row.model !== '')
}

function parseTools(value: unknown): ToolRow[] {
  return asArray(value)
    .map((entry) => {
      const d = asRecord(entry)
      return {
        tool: str(d.tool),
        requests: num(d.requests),
        users: num(d.users),
        total_tokens: num(d.total_tokens),
        cost_usd: num(d.cost_usd),
      }
    })
    .filter((row) => row.tool !== '')
}

function parseRecent(value: unknown): RecentRow[] {
  return asArray(value)
    .map((entry) => {
      const d = asRecord(entry)
      return {
        timestamp: str(d.timestamp),
        username: str(d.username),
        display_name: str(d.display_name),
        country: str(d.country),
        group_name: str(d.group_name),
        model: str(d.model),
        provider: str(d.provider),
        prompt_tokens: num(d.prompt_tokens),
        completion_tokens: num(d.completion_tokens),
        total_tokens: num(d.total_tokens),
        cached_input_tokens: num(d.cached_input_tokens),
        cache_creation_tokens: num(d.cache_creation_tokens),
        cost_usd: num(d.cost_usd),
        user_agent: str(d.user_agent),
        status_code: typeof d.status_code === 'number' && Number.isFinite(d.status_code) ? d.status_code : null,
      }
    })
    .filter((row) => row.timestamp !== '')
}

function parseUsers(value: unknown): UserRow[] {
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
        prompt_tokens: num(d.prompt_tokens),
        completion_tokens: num(d.completion_tokens),
        total_tokens: num(d.total_tokens),
        cost_usd: num(d.cost_usd),
        saved_usd: num(d.saved_usd),
      }
    })
    .filter((row) => row.username !== '')
}

function parseDirectoryUsers(value: unknown): DirectoryUser[] {
  return asArray(value)
    .map((entry) => {
      const d = asRecord(entry)
      return {
        username: str(d.username),
        user_id: str(d.user_id),
        tags: parseTags(d.tags),
        display_name: str(d.display_name),
        group_name: str(d.group_name),
      }
    })
    .filter((row) => row.username !== '')
}

/* ── dashboard reads ─────────────────────────────────────────────────── */

export interface DashboardRequest {
  filters: DashboardFilters
  isAdmin: boolean
  savingsRef: string
  userMetric: UserMetric
  fresh: boolean
  /** Aborted when a newer round starts or the page unmounts. */
  signal?: AbortSignal
}

/**
 * One refresh round: the usage reads the live page issues together (the
 * dashboard's group read is a no-op there and is omitted).
 *
 * The usage round is atomic on purpose. A partial snapshot would mix time
 * windows (fresh KPIs next to charts from the previous filter) and make a
 * broken gateway look healthy. Any rejected usage read rejects the round,
 * so the page keeps its last complete snapshot and offers Refresh to retry —
 * the same contract as the deployed `refresh()`. The directory is the one
 * exception: it only augments the user picker and degrades to the usage
 * roster.
 */
export async function fetchDashboard(request: DashboardRequest): Promise<DashboardData> {
  const { filters, isAdmin, savingsRef, userMetric, fresh, signal } = request
  const read = (path: string) => getJson(path, fresh, signal)
  const filtered = filterQuery(filters)
  const rangeOnly = rangeParts(filters).join('&')
  const chartSort = chartSortFor(userMetric)
  const [overview, chartUsers, models, tools, recent, roster, catalog, directory] = await Promise.all([
    read(`api/v1/dashboard/overview?${filtered}&ref=${encodeURIComponent(savingsRef)}`),
    read(
      `api/v1/dashboard/users?${filtered}&sort=${chartSort}&order=desc&limit=10&offset=0&savings=false`,
    ),
    read(`api/v1/dashboard/models?${filtered}`),
    read(`api/v1/dashboard/tools?${filtered}`),
    read(`api/v1/dashboard/recent?${recentQuery(filters)}`),
    read(`api/v1/dashboard/users?${rangeOnly}&limit=200&savings=false`),
    read(`api/v1/dashboard/models?${rangeOnly}`),
    // Server-side authorization: every /api/v1/dashboard/* route is wrapped
    // in RequirePartnerAdminAPI (cmd/main.go), so this client check only
    // avoids a guaranteed-403 read; it is not the access boundary.
    isAdmin ? read('api/v1/dashboard/directory-users').catch(() => []) : Promise.resolve([]),
  ])
  const catalogModels = parseModels(catalog)
  const directoryUsers = parseDirectoryUsers(directory)
  return {
    overview: parseOverview(overview),
    chartUsers: collapseUsageUsers(parseUsers(chartUsers)),
    // The gateway already applies model= on this endpoint (verified against
    // the local stack); no client-side re-filter, so every widget agrees.
    models: parseModels(models),
    tools: parseTools(tools),
    recent: parseRecent(recent),
    // Only administrators have the directory read; keep its rows out of a
    // non-admin roster even if a gateway ever returns them anyway.
    rosterUsers: mergeDirectoryUsers(
      collapseUsageUsers(parseUsers(roster)),
      directoryUsers,
      isAdmin,
    ),
    catalogModels,
    directoryUsers,
  }
}

/** Metric-toggle read: only the By User chart changes ranking. */
export async function fetchChartUsers(
  filters: DashboardFilters,
  metric: UserMetric,
): Promise<UserRow[]> {
  const rows = await getJson(
    `api/v1/dashboard/users?${filterQuery(filters)}&sort=${chartSortFor(metric)}&order=desc&limit=10&offset=0&savings=false`,
    false,
  )
  return collapseUsageUsers(parseUsers(rows))
}

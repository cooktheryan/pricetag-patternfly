/**
 * Admin console data (`/api/v1/admin/*`, `/api/v1/management/*`).
 *
 * The deployed admin page is the largest surface: partner users and their
 * roles/managers, per-user keys, the safety net, quota overrides, model
 * prices, pricing discounts, and model restrictions. Responses are parsed
 * leniently so a single shape change does not blank the tab.
 */
import { gatewayUrl } from './gateway'

export interface PartnerUser {
  user_id: string
  logins: string[]
  tags: Record<string, string>
  role: string
  active: boolean
  manager_user_id?: string
  created_at?: string
  updated_at?: string
}

export interface PartnerKey {
  id: string
  name: string
  username?: string
  status: string
  creationDate?: string
  expirationDate?: string
  expiresAt?: string
}

export interface AdminKey extends PartnerKey {
  username: string
}

export interface SafetyNet {
  default_monthly_usd: number
  default_monthly_tokens: number
  enforced: boolean
  allowed_over_limit_models: string[]
  updated_by?: string
  updated_at?: string
}

export interface BudgetOverride {
  principal: string
  monthly_usd: number
  updated_at?: string
}

export interface PriceRow {
  Managed: boolean
  Model: string
  Provider: string
  InputCost: number
  OutputCost: number
  CacheWriteCost: number
  CacheReadCost: number
}

export interface DiscountRule {
  name: string
  provider?: string
  model_prefix?: string
  multiplier: number
}

export interface Discounts {
  version: string
  rules: DiscountRule[]
}

export interface ModelPolicy {
  name?: string
  email?: string
  user_id?: string
  active: boolean
  deny_all: boolean
  models: string[]
  updated_by?: string
  updated_at?: string
}

type Json = unknown

const num = (value: unknown) => (typeof value === 'number' && Number.isFinite(value) ? value : 0)
const str = (value: unknown) => (typeof value === 'string' ? value : '')

async function getJson(path: string, signal?: AbortSignal): Promise<Json> {
  const res = await fetch(gatewayUrl(path), {
    cache: 'no-store',
    credentials: 'same-origin',
    headers: { Accept: 'application/json' },
    signal,
  })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.json()
}

async function sendJson(path: string, method: string, body: unknown): Promise<Json> {
  const res = await fetch(gatewayUrl(path), {
    method,
    cache: 'no-store',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(text.trim() || `HTTP ${res.status}`)
  }
  const text = await res.text()
  return text ? JSON.parse(text) : {}
}

function parseTags(value: unknown): Record<string, string> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return {}
  const tags: Record<string, string> = {}
  for (const [key, entry] of Object.entries(value)) {
    if (typeof entry === 'string') tags[key] = entry
  }
  return tags
}

function parsePartnerUser(value: unknown): PartnerUser | null {
  if (typeof value !== 'object' || value === null) return null
  const d = value as Record<string, unknown>
  const userId = str(d.user_id)
  if (!userId) return null
  return {
    user_id: userId,
    logins: Array.isArray(d.logins) ? d.logins.filter((x): x is string => typeof x === 'string') : [],
    tags: parseTags(d.tags),
    role: str(d.role) || 'user',
    active: d.active === true,
    manager_user_id: str(d.manager_user_id) || undefined,
    created_at: str(d.created_at) || undefined,
    updated_at: str(d.updated_at) || undefined,
  }
}

export async function fetchPartnerUsers(signal?: AbortSignal): Promise<PartnerUser[]> {
  const users: PartnerUser[] = []
  const seen = new Set<string>()
  for (let offset = 0; offset < 5000; offset += 200) {
    const payload = await getJson(
      `api/v1/admin/partner-users?limit=200&offset=${offset}&state=all`,
      signal,
    )
    const record = typeof payload === 'object' && payload !== null ? (payload as Record<string, unknown>) : {}
    const data = Array.isArray(record.users) ? record.users : []
    for (const entry of data) {
      const user = parsePartnerUser(entry)
      if (user && !seen.has(user.user_id)) {
        users.push(user)
        seen.add(user.user_id)
      }
    }
    if (!record.has_more || data.length === 0) return users
  }
  return users
}

export async function updatePartnerAccess(
  userId: string,
  role: string,
  managerUserId: string | null,
): Promise<void> {
  await sendJson(`api/v1/admin/partner-users/${encodeURIComponent(userId)}`, 'PATCH', {
    role,
    manager_user_id: managerUserId,
  })
}

export async function updateManagementUser(
  subject: string,
  name: string,
  active: boolean,
): Promise<void> {
  await sendJson('api/v1/management/users', 'PUT', { subject, name, active })
}

export async function fetchPartnerKeys(userId: string, signal?: AbortSignal): Promise<PartnerKey[]> {
  const payload = await getJson(
    `api/v1/admin/partner-users/${encodeURIComponent(userId)}/keys`,
    signal,
  )
  const record = typeof payload === 'object' && payload !== null ? (payload as Record<string, unknown>) : {}
  const data = Array.isArray(record.keys) ? record.keys : []
  return data.map((entry) => {
    const d = typeof entry === 'object' && entry !== null ? (entry as Record<string, unknown>) : {}
    return {
      id: str(d.id),
      name: str(d.name),
      username: str(d.username),
      status: str(d.status),
      creationDate: str(d.creationDate) || undefined,
      expirationDate: str(d.expirationDate) || undefined,
      expiresAt: str(d.expiresAt) || undefined,
    }
  }).filter((key) => key.id !== '')
}

export async function fetchAdminKeys(signal?: AbortSignal): Promise<AdminKey[]> {
  const payload = await getJson('api/v1/admin/keys', signal)
  const record = typeof payload === 'object' && payload !== null ? (payload as Record<string, unknown>) : {}
  const data = Array.isArray(payload)
    ? payload
    : Array.isArray(record.data)
      ? record.data
      : Array.isArray(record.keys)
        ? record.keys
        : []
  return data.map((entry) => {
    const d = typeof entry === 'object' && entry !== null ? (entry as Record<string, unknown>) : {}
    return {
      id: str(d.id),
      name: str(d.name),
      username: str(d.username),
      status: str(d.status),
      creationDate: str(d.creationDate) || undefined,
      expirationDate: str(d.expirationDate) || undefined,
      expiresAt: str(d.expiresAt) || undefined,
    }
  }).filter((key) => key.id !== '')
}

export async function createAdminKey(
  username: string,
  group: string,
  keyName: string,
  expiresIn: string,
): Promise<{ id: string; key: string }> {
  const payload = await sendJson('api/v1/admin/keys', 'POST', {
    username,
    subject: username,
    group,
    keyName,
    name: keyName,
    expiresIn,
  })
  const record = typeof payload === 'object' && payload !== null ? (payload as Record<string, unknown>) : {}
  if (typeof record.key !== 'string' || !record.key.trim() || /\s/.test(record.key)) {
    throw new Error('The key service returned no usable key.')
  }
  return { key: record.key, id: str(record.id) }
}

export async function revokeAdminKey(id: string): Promise<void> {
  const res = await fetch(gatewayUrl(`api/v1/admin/keys/${encodeURIComponent(id)}`), {
    method: 'DELETE',
    credentials: 'same-origin',
    cache: 'no-store',
  })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(text.trim() || `HTTP ${res.status}`)
  }
}

export async function fetchSafetyNet(signal?: AbortSignal): Promise<SafetyNet> {
  const d = (await getJson('api/v1/admin/safety-net', signal)) as Record<string, unknown>
  return {
    default_monthly_usd: num(d.default_monthly_usd),
    default_monthly_tokens: num(d.default_monthly_tokens),
    enforced: d.enforced === true,
    allowed_over_limit_models: Array.isArray(d.allowed_over_limit_models)
      ? d.allowed_over_limit_models.filter((x): x is string => typeof x === 'string')
      : [],
    updated_by: str(d.updated_by) || undefined,
    updated_at: str(d.updated_at) || undefined,
  }
}

export async function fetchBudgets(signal?: AbortSignal): Promise<BudgetOverride[]> {
  const rows: BudgetOverride[] = []
  for (let offset = 0; offset < 1000; offset += 50) {
    const d = (await getJson(
      `api/v1/management/budgets?limit=50&offset=${offset}&search=`,
      signal,
    )) as Record<string, unknown>
    const data = Array.isArray(d.data) ? d.data : []
    for (const entry of data) {
      const row = (entry ?? {}) as Record<string, unknown>
      rows.push({
        principal: str(row.principal),
        monthly_usd: num(row.monthly_usd),
        updated_at: str(row.updated_at) || undefined,
      })
    }
    if (!d.has_more || data.length === 0) return rows
  }
  return rows
}

export async function fetchPrices(signal?: AbortSignal): Promise<PriceRow[]> {
  const data = (await getJson('api/v1/management/prices', signal)) as unknown
  if (!Array.isArray(data)) return []
  return data.map((entry) => {
    const d = (entry ?? {}) as Record<string, unknown>
    return {
      Managed: d.Managed === true,
      Model: str(d.Model),
      Provider: str(d.Provider),
      InputCost: num(d.InputCost),
      OutputCost: num(d.OutputCost),
      CacheWriteCost: num(d.CacheWriteCost),
      CacheReadCost: num(d.CacheReadCost),
    }
  })
}

export async function fetchDiscounts(signal?: AbortSignal): Promise<Discounts> {
  const d = (await getJson('api/v1/admin/pricing-discounts', signal)) as Record<string, unknown>
  const rules = Array.isArray(d.rules) ? d.rules : []
  return {
    version: str(d.version),
    rules: rules.map((entry) => {
      const r = (entry ?? {}) as Record<string, unknown>
      return {
        name: str(r.name),
        provider: str(r.provider) || undefined,
        model_prefix: str(r.model_prefix) || undefined,
        multiplier: num(r.multiplier),
      }
    }),
  }
}

export async function fetchModelPolicies(signal?: AbortSignal): Promise<ModelPolicy[]> {
  const d = (await getJson('api/v1/admin/model-policies?limit=200&offset=0', signal)) as Record<
    string,
    unknown
  >
  const rows = Array.isArray(d.policies) ? d.policies : []
  return rows.map((entry) => {
    const r = (entry ?? {}) as Record<string, unknown>
    return {
      name: str(r.name) || undefined,
      email: str(r.email) || undefined,
      user_id: str(r.user_id) || undefined,
      active: r.active === true,
      deny_all: r.deny_all === true,
      models: Array.isArray(r.models) ? r.models.filter((x): x is string => typeof x === 'string') : [],
      updated_by: str(r.updated_by) || undefined,
      updated_at: str(r.updated_at) || undefined,
    }
  })
}

export function partnerName(user: PartnerUser): string {
  const tags = user.tags
  const name = `${tags.first_name || ''} ${tags.last_name || ''}`.trim()
  return name || tags.email || user.logins[0] || user.user_id
}

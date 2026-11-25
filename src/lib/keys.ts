/**
 * Personal API keys (`/me/keys`) — the deployed My keys contract.
 *
 * The server pages with `offset`; a page is 50 entries. The deployed gateway
 * reports `has_more`; older builds omit it, so a short page also terminates
 * the walk. Secrets are returned only by create and are never stored here.
 */
import { gatewayUrl } from './gateway'

export interface ApiKey {
  id: string
  name: string
  status: string
  expirationDate?: string
  expiresAt?: string
  creationDate?: string
  username?: string
}

export interface CreatedKey {
  id: string
  key: string
}

const PAGE_SIZE = 50
const MAX_PAGES = 100

export function keyExpiry(key: ApiKey): string {
  return key.expirationDate || key.expiresAt || ''
}

export type KeyState = 'active' | 'revoked' | 'expired' | 'unknown'

export function keyState(key: ApiKey, now = Date.now()): KeyState {
  if (key.status === 'revoked' || key.status === 'expired') return key.status
  if (key.status !== 'active') return 'unknown'
  const timestamp = Date.parse(keyExpiry(key))
  return Number.isFinite(timestamp) && timestamp <= now ? 'expired' : 'active'
}

export function remainingLabel(key: ApiKey, now = Date.now()): string {
  const expiry = keyExpiry(key)
  if (!expiry) return 'No expiry reported'
  const timestamp = Date.parse(expiry)
  if (!Number.isFinite(timestamp)) return 'Expiry unavailable'
  let seconds = Math.max(0, Math.ceil((timestamp - now) / 1000))
  if (!seconds) return 'Expired'
  const parts: string[] = []
  for (const [unit, size] of [
    ['d', 86400],
    ['h', 3600],
    ['m', 60],
    ['s', 1],
  ] as const) {
    const amount = Math.floor(seconds / size)
    seconds %= size
    if (amount || parts.length) parts.push(`${amount}${unit}`)
    if (parts.length === 2) break
  }
  return `${parts.join(' ')} remaining`
}

export function keyFilename(subject: string, name: string): string {
  const clean = (value: string) =>
    value
      .normalize('NFKC')
      .replace(/[^a-zA-Z0-9_-]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 64)
  const parts = [clean(subject), clean(name)].filter(Boolean)
  return parts.length ? `${parts.join('-')}-pricetag.key` : 'pricetag.key'
}

function parseKey(value: unknown): ApiKey | null {
  if (typeof value !== 'object' || value === null) return null
  const d = value as Record<string, unknown>
  if (typeof d.id !== 'string' || d.id === '') return null
  return {
    id: d.id,
    name: typeof d.name === 'string' ? d.name : '',
    status: typeof d.status === 'string' ? d.status : '',
    expirationDate: typeof d.expirationDate === 'string' ? d.expirationDate : undefined,
    expiresAt: typeof d.expiresAt === 'string' ? d.expiresAt : undefined,
    creationDate: typeof d.creationDate === 'string' ? d.creationDate : undefined,
    username: typeof d.username === 'string' ? d.username : undefined,
  }
}

async function listPage(offset: number, signal?: AbortSignal): Promise<{ keys: ApiKey[]; hasMore: boolean }> {
  const res = await fetch(gatewayUrl(`me/keys?offset=${offset}`), {
    cache: 'no-store',
    credentials: 'same-origin',
    headers: { Accept: 'application/json' },
    signal,
  })
  if (!res.ok) throw new Error(`Keys could not be loaded (HTTP ${res.status}).`)
  const body: unknown = await res.json()
  const data = Array.isArray(body)
    ? body
    : typeof body === 'object' && body !== null && Array.isArray((body as Record<string, unknown>).data)
      ? ((body as Record<string, unknown>).data as unknown[])
      : null
  if (!data) throw new Error('Invalid key list response.')
  const keys = data.map(parseKey).filter((key): key is ApiKey => key !== null)
  if (keys.length !== data.length) throw new Error('Invalid key metadata.')
  const hasMore =
    typeof body === 'object' && body !== null && typeof (body as Record<string, unknown>).has_more === 'boolean'
      ? ((body as Record<string, unknown>).has_more as boolean)
      : data.length >= PAGE_SIZE
  return { keys, hasMore }
}

export async function fetchAllKeys(signal?: AbortSignal): Promise<ApiKey[]> {
  const keys: ApiKey[] = []
  const seen = new Set<string>()
  for (let page = 0; page < MAX_PAGES; page++) {
    const result = await listPage(page * PAGE_SIZE, signal)
    if (result.hasMore && result.keys.length === 0) {
      throw new Error('Key service returned an empty page with more results.')
    }
    for (const key of result.keys) {
      if (!seen.has(key.id)) {
        keys.push(key)
        seen.add(key.id)
      }
    }
    if (!result.hasMore) return keys
  }
  throw new Error('Too many keys to search safely in this view.')
}

export async function createKey(name: string, expiresIn: string): Promise<CreatedKey> {
  const res = await fetch(gatewayUrl('me/keys'), {
    method: 'POST',
    cache: 'no-store',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, expiresIn }),
  })
  if (!res.ok) throw new Error(`Could not create the key (HTTP ${res.status}).`)
  const body: unknown = await res.json()
  if (typeof body !== 'object' || body === null) throw new Error('Invalid create-key response.')
  const d = body as Record<string, unknown>
  if (typeof d.key !== 'string' || !d.key.trim() || /\s/.test(d.key)) {
    throw new Error(
      'The key service returned no usable key. Check your key list before issuing another.',
    )
  }
  return { key: d.key, id: typeof d.id === 'string' ? d.id : '' }
}

export async function revokeKey(id: string): Promise<void> {
  const res = await fetch(gatewayUrl(`me/keys/${encodeURIComponent(id)}`), {
    method: 'DELETE',
    cache: 'no-store',
    credentials: 'same-origin',
  })
  if (!res.ok) throw new Error(`Could not revoke the key (HTTP ${res.status}).`)
}

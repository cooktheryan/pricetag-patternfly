import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react'
import { gatewayUrl } from './gateway'

/** Monthly budget state carried by /whoami (and /api/v1/me/quota). */
export interface Quota {
  enforced: boolean
  exempt: boolean
  limit_usd: number
  spent_usd: number
  month?: string
}

/** Shape of the gateway's /whoami response. */
export interface WhoAmI {
  user: string
  groups: string[]
  isAdmin: boolean
  isSuperAdmin: boolean
  keyServiceEnabled: boolean
  impersonating: boolean
  real_user: string
  real_user_display?: string
  display_name: string
  managementEnabled?: boolean
  /** Org-scope fields: /manager visibility and the manager page KPI. */
  isManager?: boolean
  scopeSize?: number
  /** Present when management (budgets) is enabled for this user. */
  quota?: Quota
}

/** Distinguishes "signed out" from "the gateway could not be reached". */
export type SessionStatus = 'loading' | 'authed' | 'unauthed' | 'error'

interface SessionState {
  who: WhoAmI | null
  status: SessionStatus
  loading: boolean
  /** Re-reads /whoami and resolves with the fresh session state. */
  refresh: () => Promise<{ status: SessionStatus; who: WhoAmI | null }>
}

const SessionContext = createContext<SessionState>({
  who: null,
  status: 'loading',
  loading: true,
  refresh: async () => ({ status: 'unauthed', who: null }),
})

function parseQuota(value: unknown): Quota | undefined {
  if (typeof value !== 'object' || value === null) return undefined
  const q = value as Record<string, unknown>
  // A quota without numeric limits is not a quota; treating an empty object
  // as one would render a false "$0 of $0" budget banner.
  if (
    typeof q.limit_usd !== 'number' ||
    !Number.isFinite(q.limit_usd) ||
    q.limit_usd < 0 ||
    typeof q.spent_usd !== 'number' ||
    !Number.isFinite(q.spent_usd) ||
    q.spent_usd < 0
  ) {
    return undefined
  }
  return {
    enforced: q.enforced === true,
    exempt: q.exempt === true,
    limit_usd: q.limit_usd,
    spent_usd: q.spent_usd,
    month: typeof q.month === 'string' ? q.month : undefined,
  }
}

/**
 * The response comes from the same-origin gateway, but a proxy hiccup can
 * still deliver something that is not the expected object. Validate the
 * fields the UI trusts for routing and gating before storing them.
 */
function parseWhoAmI(data: unknown): WhoAmI | null {
  if (typeof data !== 'object' || data === null) return null
  const d = data as Record<string, unknown>
  if (typeof d.user !== 'string' || d.user === '') return null
  return {
    user: d.user,
    groups: Array.isArray(d.groups) ? d.groups.filter((g): g is string => typeof g === 'string') : [],
    isAdmin: d.isAdmin === true,
    isSuperAdmin: d.isSuperAdmin === true,
    keyServiceEnabled: d.keyServiceEnabled === true,
    impersonating: d.impersonating === true,
    real_user: typeof d.real_user === 'string' ? d.real_user : '',
    real_user_display: typeof d.real_user_display === 'string' ? d.real_user_display : undefined,
    display_name: typeof d.display_name === 'string' ? d.display_name : '',
    managementEnabled: d.managementEnabled === true,
    isManager: d.isManager === true,
    scopeSize: typeof d.scopeSize === 'number' ? d.scopeSize : undefined,
    quota: parseQuota(d.quota),
  }
}

/**
 * fetch /whoami and classify the outcome. A non-JSON 2xx/3xx-follow is the
 * unauthenticated case: the gateway redirects to the login page, and the
 * dev proxy's SPA fallback serves that page's HTML. 401/403/404 are treated
 * as unauthenticated too (the session is not valid for this surface); any
 * other non-2xx — including throttling and outages — is an error, not a
 * sign-out. A 2xx JSON body that does not parse into the expected shape is
 * a gateway contract failure, which is also an error rather than a
 * sign-out.
 */
async function fetchWhoAmI(): Promise<{ status: SessionStatus; who: WhoAmI | null }> {
  try {
    const res = await fetch(gatewayUrl('whoami'), {
      credentials: 'same-origin',
      headers: { Accept: 'application/json' },
    })
    if (res.status === 401 || res.status === 403 || res.status === 404) {
      return { status: 'unauthed', who: null }
    }
    if (!res.ok) {
      return { status: 'error', who: null }
    }
    const type = res.headers.get('content-type') ?? ''
    if (!type.includes('application/json')) {
      return { status: 'unauthed', who: null }
    }
    const who = parseWhoAmI(await res.json())
    return who
      ? { status: 'authed', who }
      : { status: 'error', who: null }
  } catch {
    return { status: 'error', who: null }
  }
}

export function SessionProvider({ children }: { children: React.ReactNode }) {
  const [who, setWho] = useState<WhoAmI | null>(null)
  const [status, setStatus] = useState<SessionStatus>('loading')
  // Generation counter: only the most recent in-flight /whoami read may
  // update state, so a slow stale response cannot overwrite a newer one
  // (for example around login/logout transitions).
  const generation = useRef(0)

  useEffect(() => {
    const gen = ++generation.current
    fetchWhoAmI().then(({ status: s, who: w }) => {
      if (gen === generation.current) {
        setWho(w)
        setStatus(s)
      }
    })
  }, [])

  const refresh = useCallback(async () => {
    const gen = ++generation.current
    const result = await fetchWhoAmI()
    if (gen === generation.current) {
      setWho(result.who)
      setStatus(result.status)
    }
    return result
  }, [])

  return (
    <SessionContext.Provider value={{ who, status, loading: status === 'loading', refresh }}>
      {children}
    </SessionContext.Provider>
  )
}

export function useSession() {
  return useContext(SessionContext)
}

/**
 * Gateway endpoints are rooted at the serving origin. Every gateway call —
 * fetches and the native form POSTs — goes through this helper so the
 * Vite base is applied consistently across the app.
 *
 * Note: the gateway itself redirects to root-relative destinations
 * (/login, /dashboard, /account), so a non-root base additionally requires
 * gateway-side support. The deployment contract is a root-mounted SPA
 * behind a reverse proxy (see the Phase 8 nginx plan).
 */
export function gatewayUrl(path: string): string {
  const base = import.meta.env.BASE_URL.replace(/\/$/, '')
  return `${base}/${path.replace(/^\//, '')}`
}

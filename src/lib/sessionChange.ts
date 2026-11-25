import { gatewayUrl } from './gateway'

/**
 * Session-changing operations are native form POSTs, not fetch calls, so the
 * browser follows the gateway's 302 and lands on the SPA route it chooses.
 *
 * CSRF boundary (verified in internal/handler/auth.go):
 *   - `confirmSessionChange` accepts POST only and returns 403 unless
 *     `Origin === MANAGEMENT_PUBLIC_ORIGIN` and `Sec-Fetch-Site` is not
 *     `cross-site`.
 *   - The session cookie is HttpOnly and SameSite=Lax, so a cross-site form
 *     POST does not carry it; the Origin check is defence in depth.
 *   - There is no server-issued CSRF token to embed; the deployed page uses
 *     this same native POST contract.
 *
 * `HandleImpersonate` reads the target from the query string (`?as=`), so
 * the action carries it there. The dialog also renders a hidden `as` field
 * as a body fallback without changing that contract. Omitting `as` returns
 * to the administrator's own view.
 *
 * Authorization is entirely server-side and this form is not a boundary:
 * HandleImpersonate re-authenticates the session, requires a partner
 * super-admin, rejects a target that is not an active directory account,
 * and canonicalizes the login before setting the impersonation cookie
 * (internal/handler/auth.go). A modified `as` value is revalidated there.
 */
export function impersonateAction(username?: string): string {
  const action = gatewayUrl('admin/impersonate')
  return username ? `${action}?as=${encodeURIComponent(username)}` : action
}

import { Link, Navigate, Outlet, Route, Routes } from 'react-router'
import { Bullseye, Button, EmptyState, EmptyStateBody, Spinner } from '@patternfly/react-core'
import { SessionProvider, useSession } from './lib/session'
import { AppShell } from './components/AppShell'
import { LoginPage } from './pages/LoginPage'
import { DashboardPage } from './pages/DashboardPage'
import { ManagerPage } from './pages/ManagerPage'
import { KeysPage, KeysUnavailablePage } from './pages/KeysPage'
import { AdminPage } from './pages/AdminPage'
import { AccountPage } from './pages/AccountPage'

/** Gate shell routes on an established gateway session. */
function RequireSession() {
  const { who, status, refresh } = useSession()

  if (status === 'loading') {
    return (
      <Bullseye>
        <Spinner size="xl" />
      </Bullseye>
    )
  }
  if (status === 'error') {
    return (
      <Bullseye>
        <EmptyState titleText="Cannot reach the gateway" icon={undefined} headingLevel="h2">
          <EmptyStateBody>
            The usage service did not answer. Your session was kept; retry to continue.
          </EmptyStateBody>
          <Button variant="primary" onClick={() => void refresh()}>
            Retry
          </Button>
        </EmptyState>
      </Bullseye>
    )
  }
  if (!who?.user) {
    return <Navigate to="/login" replace />
  }
  return (
    <AppShell>
      <Outlet />
    </AppShell>
  )
}

/**
 * Route-level role guard, mirroring the legacy RequireSuperAdmin behavior:
 * privileged pages bounce unauthorized (but signed-in) users to /dashboard
 * instead of relying on sidebar visibility.
 */
function RequireRole({
  allow,
  redirectTo = '/dashboard',
  children,
}: {
  allow: (who: NonNullable<ReturnType<typeof useSession>['who']>) => boolean
  redirectTo?: string
  children: React.ReactNode
}) {
  const { who } = useSession()
  if (!who || !allow(who)) {
    return <Navigate to={redirectTo} replace />
  }
  return <>{children}</>
}

/**
 * The key self-service surface requires the key service to be enabled
 * (whoami.keyServiceEnabled). Rather than bouncing the user elsewhere, an
 * explicit unavailable state explains why the page cannot be used.
 */
function RequireKeyService({ children }: { children: React.ReactNode }) {
  const { who } = useSession()
  if (!who?.keyServiceEnabled) {
    return (
      <AppShell>
        <KeysUnavailablePage />
      </AppShell>
    )
  }
  return <>{children}</>
}

/**
 * "/" lands the user on their role's home (legacy loginDestination logic):
 * administrators get the org-wide usage dashboard, everyone else their
 * personal account page. Signed-out users flow through the session gate to
 * the login page.
 */
function LandingRedirect() {
  const { who, status } = useSession()

  if (status === 'authed') {
    const isAdmin = who?.isAdmin === true || who?.isSuperAdmin === true
    return <Navigate to={isAdmin ? '/dashboard' : '/account'} replace />
  }
  if (status === 'unauthed') {
    return <Navigate to="/login" replace />
  }
  if (status === 'error') {
    // The /dashboard route's session gate owns the retry UI.
    return <Navigate to="/dashboard" replace />
  }
  return (
    <Bullseye>
      <Spinner size="xl" />
    </Bullseye>
  )
}

function NotFoundPage() {
  return (
    <Bullseye>
      <EmptyState titleText="Page not found" headingLevel="h2">
        <EmptyStateBody>
          The page you requested does not exist. <Link to="/dashboard">Go to the dashboard</Link>.
        </EmptyStateBody>
      </EmptyState>
    </Bullseye>
  )
}

export default function App() {
  return (
    <SessionProvider>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route element={<RequireSession />}>
          <Route
            path="/dashboard"
            element={
              // Legacy: the org-wide usage page is administrator-only;
              // regular users are redirected to the personal account page.
              <RequireRole allow={(who) => who.isAdmin || who.isSuperAdmin} redirectTo="/account">
                <DashboardPage />
              </RequireRole>
            }
          />
          <Route
            path="/manager"
            element={
              <RequireRole allow={(who) => who.isManager || who.isSuperAdmin} redirectTo="/account">
                <ManagerPage />
              </RequireRole>
            }
          />
          <Route
            path="/management"
            element={
              <RequireKeyService>
                <KeysPage />
              </RequireKeyService>
            }
          />
          <Route
            path="/admin"
            element={
              <RequireRole allow={(who) => who.isSuperAdmin}>
                <AdminPage />
              </RequireRole>
            }
          />
          <Route path="/account" element={<AccountPage />} />
        </Route>
        <Route path="/" element={<LandingRedirect />} />
        <Route path="*" element={<NotFoundPage />} />
      </Routes>
    </SessionProvider>
  )
}

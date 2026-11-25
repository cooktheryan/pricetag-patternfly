import { useState } from 'react'
import { useLocation, useNavigate } from 'react-router'
import {
  ActionList,
  ActionListItem,
  Button,
  Masthead,
  MastheadBrand,
  MastheadContent,
  MastheadMain,
  MastheadToggle,
  Modal,
  ModalFooter,
  Nav,
  NavItem,
  NavList,
  Page,
  PageSidebar,
  PageSidebarBody,
  PageToggleButton,
  Toolbar,
  ToolbarContent,
  ToolbarGroup,
  ToolbarItem,
} from '@patternfly/react-core'
import BarsIcon from '@patternfly/react-icons/dist/esm/icons/bars-icon'
import { Brand } from './Brand'
import { Clock } from './Clock'
import { useSession } from '../lib/session'

interface NavEntry {
  to: string
  label: string
  /** Visibility predicates, mirroring the legacy server-side gating. */
  requiresAdmin?: boolean
  requiresTeam?: boolean
  requiresSuperAdmin?: boolean
  requiresKeyService?: boolean
}

const NAV_ENTRIES: NavEntry[] = [
  // Live-UI parity: Usage (/dashboard, administrators), My team (/manager),
  // My keys (/management), Admin (/admin, super administrators).
  { to: '/dashboard', label: 'Usage', requiresAdmin: true },
  { to: '/manager', label: 'My team', requiresTeam: true },
  { to: '/management', label: 'My keys', requiresKeyService: true },
  { to: '/admin', label: 'Admin', requiresSuperAdmin: true },
]

export function AppShell({ children }: { children: React.ReactNode }) {
  const [isSidebarOpen, setIsSidebarOpen] = useState(true)
  const [isSignOutOpen, setIsSignOutOpen] = useState(false)
  const [signingOut, setSigningOut] = useState(false)
  const [signOutError, setSignOutError] = useState('')
  const navigate = useNavigate()
  const location = useLocation()
  const { who, status, refresh } = useSession()

  const entries = NAV_ENTRIES.filter(
    (e) =>
      (!e.requiresAdmin || who?.isAdmin || who?.isSuperAdmin) &&
      (!e.requiresTeam || who?.isSuperAdmin || who?.isManager) &&
      (!e.requiresKeyService || who?.keyServiceEnabled) &&
      (!e.requiresSuperAdmin || who?.isSuperAdmin),
  )

  /**
   * Legacy parity: signing out is a two-step confirmation
   * (session_confirmation.go). GET /logout renders the dialog; POST /logout
   * clears the cookie and redirects to /login. The SPA renders its own
   * dialog and issues the POST directly. The redirect response is opaque
   * to fetch, so the outcome is taken from the authoritative source: the
   * /whoami re-read. A surviving session means the gateway did not sign
   * the user out; an error means it could not be reached.
   */
  async function handleSignOut() {
    setSigningOut(true)
    setSignOutError('')
    try {
      await fetch('/logout', {
        method: 'POST',
        credentials: 'same-origin',
        redirect: 'manual',
      })
    } catch {
      setSignOutError('The gateway could not be reached.')
      setSigningOut(false)
      return
    }
    await refresh()
    setSigningOut(false)
    if (status === 'authed') {
      setSignOutError('The gateway did not sign you out. Try again.')
      return
    }
    if (status === 'error') {
      setSignOutError('The gateway could not be reached.')
      return
    }
    setIsSignOutOpen(false)
    navigate('/login', { replace: true })
  }

  const masthead = (
    <Masthead>
      <MastheadToggle>
        <PageToggleButton
          variant="plain"
          aria-label="Toggle navigation"
          isSidebarOpen={isSidebarOpen}
          onSidebarToggle={() => setIsSidebarOpen(!isSidebarOpen)}
        >
          <BarsIcon />
        </PageToggleButton>
      </MastheadToggle>
      <MastheadMain>
        <MastheadBrand onClick={() => navigate('/dashboard')}>
          <Brand />
        </MastheadBrand>
      </MastheadMain>
      <MastheadContent>
        <Toolbar>
          <ToolbarContent>
            <ToolbarGroup align={{ default: 'alignEnd' }}>
              <ToolbarItem>
                <Clock />
              </ToolbarItem>
              {who?.user && (
                <ToolbarItem>
                  <span>
                    {who.display_name || who.user}
                    {who.isSuperAdmin ? ' (super admin)' : who.isAdmin ? ' (admin)' : ''}
                  </span>
                </ToolbarItem>
              )}
              <ToolbarItem>
                <Button variant="link" onClick={() => setIsSignOutOpen(true)}>
                  Sign out
                </Button>
              </ToolbarItem>
            </ToolbarGroup>
          </ToolbarContent>
        </Toolbar>
      </MastheadContent>
    </Masthead>
  )

  const sidebar = (
    <PageSidebar isSidebarOpen={isSidebarOpen}>
      <PageSidebarBody>
        <Nav>
          <NavList>
            {entries.map((entry) => (
              <NavItem
                key={entry.to}
                itemId={entry.to}
                isActive={
                  location.pathname === entry.to ||
                  location.pathname.startsWith(`${entry.to}/`)
                }
                onClick={() => navigate(entry.to)}
              >
                {entry.label}
              </NavItem>
            ))}
          </NavList>
        </Nav>
      </PageSidebarBody>
    </PageSidebar>
  )

  return (
    <Page masthead={masthead} sidebar={sidebar}>
      {children}
      <Modal
        title="Sign out"
        isOpen={isSignOutOpen}
        onClose={() => setIsSignOutOpen(false)}
        variant="small"
      >
        Sign out of this browser session?
        {signOutError !== '' && (
          <p className="pf-v6-c-form__helper-text pf-m-error">{signOutError}</p>
        )}
        <ModalFooter>
          <ActionList>
            <ActionListItem>
              <Button
                key="cancel"
                variant="link"
                isDisabled={signingOut}
                onClick={() => setIsSignOutOpen(false)}
              >
                Cancel
              </Button>
            </ActionListItem>
            <ActionListItem>
              <Button key="continue" variant="primary" isDisabled={signingOut} onClick={handleSignOut}>
                {signingOut ? 'Signing out…' : 'Continue'}
              </Button>
            </ActionListItem>
          </ActionList>
        </ModalFooter>
      </Modal>
    </Page>
  )
}

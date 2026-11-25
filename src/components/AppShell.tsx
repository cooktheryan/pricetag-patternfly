import { useState } from 'react'
import { useLocation, useNavigate } from 'react-router'
import {
  ActionList,
  ActionListItem,
  Button,
  Form,
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
import { gatewayUrl } from '../lib/gateway'

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
  const navigate = useNavigate()
  const location = useLocation()
  const { who } = useSession()

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
   * clears the cookie and redirects to /login. Like the legacy dialog, the
   * SPA's Continue button submits a native form POST to /logout and lets
   * the browser follow the gateway's redirect — no fetch, no opaque
   * response to interpret.
   */

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
        {/* Native form POST, exactly like the legacy confirmation page:
            the gateway answers 302 -> /login and the browser follows it
            onto the SPA's login route with the session cleared. The
            gateway endpoint is root-relative by contract, like every
            other gateway path the app uses. */}
        <Form action={gatewayUrl('logout')} method="post">
          <p>Sign out of this browser session?</p>
          <ModalFooter>
            <ActionList>
              <ActionListItem>
                <Button key="cancel" variant="link" type="button" onClick={() => setIsSignOutOpen(false)}>
                  Cancel
                </Button>
              </ActionListItem>
              <ActionListItem>
                <Button key="continue" variant="primary" type="submit">
                  Continue
                </Button>
              </ActionListItem>
            </ActionList>
          </ModalFooter>
        </Form>
      </Modal>
    </Page>
  )
}

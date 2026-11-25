import { EmptyState, EmptyStateBody, PageSection, Title } from '@patternfly/react-core'
import HelpIcon from '@patternfly/react-icons/dist/esm/icons/help-icon'

/**
 * Legacy parity: plain users land here after login (AuthHandler routes
 * non-admin, non-manager identities to /account). In standalone mode the
 * legacy server serves a bare 404 for it.
 */
export function AccountPage() {
  return (
    <PageSection>
      <Title headingLevel="h1" size="lg">
        My account
      </Title>
      <EmptyState
        titleText="Account view unavailable"
        icon={HelpIcon}
        headingLevel="h2"
      >
        <EmptyStateBody>
          The personal account view is not available in this deployment. Contact your administrator if you believe this
          is a mistake.
        </EmptyStateBody>
      </EmptyState>
    </PageSection>
  )
}

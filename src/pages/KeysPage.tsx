import { EmptyState, EmptyStateBody, PageSection, Title } from '@patternfly/react-core'
import KeyIcon from '@patternfly/react-icons/dist/esm/icons/key-icon'

/** Phase 5: key self-service (old /management). */
export function KeysPage() {
  return (
    <PageSection>
      <Title headingLevel="h1" size="lg">
        My keys
      </Title>
      <p>API key management — coming in Phase 5.</p>
    </PageSection>
  )
}

/** Rendered when whoami.keyServiceEnabled is false. */
export function KeysUnavailablePage() {
  return (
    <PageSection>
      <Title headingLevel="h1" size="lg">
        My keys
      </Title>
      <EmptyState titleText="API key management unavailable" icon={KeyIcon} headingLevel="h2">
        <EmptyStateBody>
          API key management is not enabled on this gateway. Contact your administrator if you believe this is a
          mistake.
        </EmptyStateBody>
      </EmptyState>
    </PageSection>
  )
}

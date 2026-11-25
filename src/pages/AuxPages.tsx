import type { ReactNode } from 'react'
import {
  Bullseye,
  Button,
  Card,
  CardBody,
  EmptyState,
  EmptyStateBody,
  Form,
  PageSection,
  Title,
} from '@patternfly/react-core'
import { Link } from 'react-router'
import logo from '../assets/red-hat-logo.svg'
import { gatewayUrl } from '../lib/gateway'
import './aux.css'

function PublicFrame({ children }: { children: ReactNode }) {
  return (
    <PageSection>
      <Bullseye>
        <Card className="pf-aux-card">
          <CardBody>
            <img src={logo} alt="Red Hat" height={36} width={48} />
            {children}
          </CardBody>
        </Card>
      </Bullseye>
    </PageSection>
  )
}

/** Onboarding/landing page (`/welcome`). */
export function WelcomePage() {
  return (
    <PublicFrame>
      <Title headingLevel="h1" size="2xl">
        Welcome to PriceTag
      </Title>
      <p>
        PriceTag meters model usage across your team, shows where spend goes, and keeps hosted
        and vendor traffic in one view.
      </p>
      <p>
        Sign in with your API key to see your usage, manage personal keys, or open the
        organisation dashboard if you are an administrator.
      </p>
      <div className="pf-aux-actions">
        <Button
          variant="primary"
          onClick={() => {
            window.location.href = gatewayUrl('login')
          }}
        >
          Sign in
        </Button>
        <Link to="/dashboard">Continue to the dashboard</Link>
      </div>
    </PublicFrame>
  )
}

/** Placeholder for a surface that is not enabled yet (`/coming-soon`). */
export function ComingSoonPage() {
  return (
    <PublicFrame>
      <EmptyState titleText="Coming soon" headingLevel="h2">
        <EmptyStateBody>
          This part of PriceTag is not enabled in this deployment yet. <Link to="/">Return home</Link>.
        </EmptyStateBody>
      </EmptyState>
    </PublicFrame>
  )
}

/** Budget-gate block page (`/blocked`). */
export function BlockedPage() {
  return (
    <PublicFrame>
      <EmptyState titleText="Access blocked" headingLevel="h2">
        <EmptyStateBody>
          Your account has reached its monthly usage budget, so further requests are blocked. Ask
          an administrator for a quota override, or sign out and use another account.
        </EmptyStateBody>
        <Form action={gatewayUrl('logout')} method="post">
          <Button type="submit" variant="primary">
            Sign out
          </Button>
        </Form>
        <p className="pf-aux-note">
          <Link to="/login">Return to sign in</Link>
        </p>
      </EmptyState>
    </PublicFrame>
  )
}

import { useState } from 'react'
import { Navigate, useSearchParams } from 'react-router'
import {
  ActionGroup,
  Button,
  Form,
  FormGroup,
  FormHelperText,
  HelperText,
  HelperTextItem,
  LoginPage as PFLoginPage,
  TextInput,
} from '@patternfly/react-core'
import logo from '../assets/red-hat-logo.svg'
import { useSession } from '../lib/session'
import { gatewayUrl } from '../lib/gateway'

/**
 * Legacy parity (internal/dashboard/login.html): a single masked api_key
 * field. The form is a native POST to /login — the gateway answers with a
 * 302 to the role destination (/dashboard, /manager, /account) on success
 * or back to /login?error=invalid on failure, and the browser follows it,
 * exactly like the legacy UI. Because every destination is an SPA route,
 * the redirect lands on the right page with the session bootstrapped.
 */
export function LoginPage() {
  const [apiKey, setApiKey] = useState('')
  const [busy, setBusy] = useState(false)
  const [params] = useSearchParams()
  const { who, status } = useSession()
  const error = params.get('error') === 'invalid' ? 'Invalid API key.' : ''

  // An already-authenticated user has no business on the credential form;
  // send them to their role's landing page.
  if (status === 'authed' && who?.user) {
    return (
      <Navigate
        to={who.isSuperAdmin || who.isAdmin ? '/dashboard' : who.isManager ? '/manager' : '/account'}
        replace
      />
    )
  }

  return (
    <PFLoginPage brandImgSrc={logo} brandImgAlt="Red Hat" loginTitle="Log in to your account">
      {/* Gateway endpoints are root-relative by contract (the dev proxy and
          the production nginx reverse proxy both forward them from the
          serving origin), matching every fetch in the app. */}
      <Form
        action={gatewayUrl('login')}
        method="post"
        onSubmit={() => setBusy(true)}
      >
        <FormGroup label="API Key" isRequired fieldId="api_key">
          <TextInput
            id="api_key"
            name="api_key"
            type="password"
            autoComplete="off"
            isRequired
            aria-label="API key"
            placeholder="sk-oai-..."
            value={apiKey}
            onChange={(_, value) => setApiKey(value)}
            validated={error ? 'error' : 'default'}
            style={{ fontFamily: 'var(--pf-t--global--font--family--mono)' }}
          />
          {error !== '' && (
            <FormHelperText>
              <HelperText>
                <HelperTextItem variant="error">{error}</HelperTextItem>
              </HelperText>
            </FormHelperText>
          )}
        </FormGroup>
        <ActionGroup>
          <Button
            type="submit"
            variant="primary"
            isDisabled={busy || apiKey.trim() === ''}
          >
            Log In
          </Button>
        </ActionGroup>
      </Form>
    </PFLoginPage>
  )
}

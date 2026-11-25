import { useEffect, useMemo, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import {
  ActionGroup,
  Alert,
  Bullseye,
  Button,
  Card,
  CardBody,
  CardTitle,
  EmptyState,
  EmptyStateBody,
  Form,
  FormGroup,
  FormSelect,
  FormSelectOption,
  Label,
  Modal,
  ModalBody,
  ModalFooter,
  ModalHeader,
  PageSection,
  SearchInput,
  Spinner,
  Tab,
  Tabs,
  TextInput,
  Title,
  Toolbar,
  ToolbarContent,
  ToolbarGroup,
  ToolbarItem,
} from '@patternfly/react-core'
import { Table, Tbody, Td, Th, Thead, Tr } from '@patternfly/react-table'
import KeyIcon from '@patternfly/react-icons/dist/esm/icons/key-icon'
import { useSession } from '../lib/session'
import type { ApiKey, KeyState } from '../lib/keys'
import {
  createKey,
  fetchAllKeys,
  keyExpiry,
  keyFilename,
  keyState,
  remainingLabel,
  revokeKey,
} from '../lib/keys'
import '../components/keys/keys.css'

type StatusFilter = 'active' | 'revoked' | 'expired' | 'all'

const STATUS_OPTIONS: { value: StatusFilter; label: string }[] = [
  { value: 'active', label: 'Active' },
  { value: 'revoked', label: 'Revoked' },
  { value: 'expired', label: 'Expired' },
  { value: 'all', label: 'All' },
]

function statusColor(state: KeyState): 'green' | 'red' | 'orange' | 'grey' {
  if (state === 'active') return 'green'
  if (state === 'revoked') return 'red'
  if (state === 'expired') return 'orange'
  return 'grey'
}

/** Phase 5: personal API key self-service (`/management`). */
export function KeysPage() {
  const { who } = useSession()
  const [keys, setKeys] = useState<ApiKey[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [tab, setTab] = useState(0)
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('active')
  const [pageSize, setPageSize] = useState(5)
  const [page, setPage] = useState(1)
  const [now, setNow] = useState(Date.now())
  const [reload, setReload] = useState(0)
  const [revokeTarget, setRevokeTarget] = useState<ApiKey | null>(null)
  const [revoking, setRevoking] = useState(false)
  const [createName, setCreateName] = useState('')
  const [createLifetime, setCreateLifetime] = useState('30d')
  const [creating, setCreating] = useState(false)
  const [created, setCreated] = useState<{ key: string; id: string; name: string } | null>(null)
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'error'>('idle')
  const identity = who?.user ?? ''
  const impersonating = who?.impersonating === true
  const keyServiceEnabled = who?.keyServiceEnabled === true
  const sessionRef = useRef('')
  useEffect(() => {
    sessionRef.current = `${identity}|${keyServiceEnabled}|${impersonating}`
  }, [identity, keyServiceEnabled, impersonating])

  useEffect(() => {
    // Never show the previous identity's keys while a new session is
    // settling (logout/login, impersonation switch).
    setKeys([])
    if (!identity || impersonating || !keyServiceEnabled) {
      setLoading(false)
      return
    }
    const controller = new AbortController()
    setLoading(true)
    setError('')
    fetchAllKeys(controller.signal)
      .then((next) => {
        if (!controller.signal.aborted) setKeys(next)
      })
      .catch((reason: unknown) => {
        if (!controller.signal.aborted) {
          setKeys([])
          setError(reason instanceof Error ? reason.message : 'Keys could not be loaded.')
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false)
      })
    return () => controller.abort()
  }, [reload, identity, impersonating, keyServiceEnabled])

  // Keep expiry countdowns and the active/expired classification live.
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [])

  // The reveal-once secret must not survive navigation away from the page.
  useEffect(() => {
    const clear = () => {
      setCreated(null)
      setCopyState('idle')
    }
    window.addEventListener('pagehide', clear)
    return () => {
      window.removeEventListener('pagehide', clear)
      // SPA navigation unmounts this component without a pagehide; drop the
      // reveal-once secret explicitly as well.
      clear()
    }
  }, [])

  useEffect(() => {
    setPage(1)
  }, [search, statusFilter, pageSize])

  // Bound the reveal window even if the user leaves the panel open.
  useEffect(() => {
    if (!created) return
    const timer = setTimeout(() => {
      setCreated(null)
      setCopyState('idle')
    }, 5 * 60_000)
    return () => clearTimeout(timer)
  }, [created])

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase()
    return keys
      .filter((key) => statusFilter === 'all' || keyState(key, now) === statusFilter)
      .filter((key) => `${key.name} ${key.id}`.toLowerCase().includes(query))
      .sort(
        (left, right) =>
          Number(keyState(right, now) === 'active') - Number(keyState(left, now) === 'active'),
      )
  }, [keys, now, search, statusFilter])

  const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize))
  const currentPage = Math.min(page, pageCount)
  const pageRows = filtered.slice((currentPage - 1) * pageSize, currentPage * pageSize)

  const onCreate = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const name = createName.trim()
    const lifetime = createLifetime.trim()
    if (!name) {
      setError('Name is required.')
      return
    }
    const lifetimeMatch = /^([0-9]{1,4})([smhd])$/.exec(lifetime)
    const lifetimeAmount = Number(lifetimeMatch?.[1] || 0)
    if (!lifetimeMatch || lifetimeAmount < 1 || lifetimeAmount > 3650) {
      setError('Lifetime must be a duration like 30d, 12h, or 45m.')
      return
    }
    setCreating(true)
    setError('')
    const startingSession = sessionRef.current
    try {
      const result = await createKey(name, lifetime)
      if (sessionRef.current !== startingSession) {
        setCreated(null)
        setError(
          'Your session changed while the key was being created. Check My keys; the new secret was discarded.',
        )
        setReload((value) => value + 1)
        return
      }
      setCreated({ ...result, name })
      setCopyState('idle')
      setSearch('')
      setStatusFilter('active')
      setPage(1)
      setReload((value) => value + 1)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not create the key.')
    } finally {
      setCreating(false)
    }
  }

  const onCopy = async () => {
    if (!created) return
    try {
      await navigator.clipboard.writeText(created.key)
      setCopyState('copied')
    } catch {
      setCopyState('error')
      setError('Clipboard access was denied. Use Download .key instead.')
    }
  }

  const clearClipboard = async () => {
    try {
      await navigator.clipboard.writeText('')
      setCopyState('idle')
    } catch {
      setCopyState('error')
      setError('Could not clear the clipboard. Clear it from your system clipboard settings.')
    }
  }

  const onDownload = () => {
    if (!created) return
    const url = URL.createObjectURL(new Blob([`${created.key}\n`], { type: 'text/plain' }))
    const link = document.createElement('a')
    link.href = url
    link.download = keyFilename(who?.user || '', created.name)
    try {
      document.body.append(link)
      link.click()
    } finally {
      link.remove()
      setTimeout(() => URL.revokeObjectURL(url), 1000)
    }
  }

  const dismissCreated = () => {
    setCreated(null)
    setCopyState('idle')
  }

  const onRevoke = async () => {
    if (!revokeTarget) return
    setRevoking(true)
    setError('')
    try {
      await revokeKey(revokeTarget.id)
      setKeys((current) =>
        current.map((key) =>
          key.id === revokeTarget.id ? { ...key, status: 'revoked' } : key,
        ),
      )
      setRevokeTarget(null)
      setReload((value) => value + 1)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not revoke the key.')
      setRevokeTarget(null)
    } finally {
      setRevoking(false)
    }
  }

  if (!who) {
    return (
      <PageSection>
        <Bullseye>
          <Spinner size="xl" aria-label="Loading session" />
        </Bullseye>
      </PageSection>
    )
  }

  const unavailable = impersonating
    ? 'Key management is unavailable while viewing as another user.'
    : !keyServiceEnabled
      ? 'Key management is not configured on this gateway.'
      : ''

  return (
    <PageSection>
      <div className="pf-keys-page">
        <header>
          <Title headingLevel="h1" size="2xl">
            My keys
          </Title>
          <p className="pf-keys-sub">
            Create and revoke the API keys used by your devices and AI clients.
          </p>
        </header>

        {error && (
          <Alert variant="danger" isInline title="Key operation failed">
            <p>{error}</p>
          </Alert>
        )}

        {unavailable ? (
          <Alert variant="warning" isInline title={unavailable} />
        ) : (
          <Tabs
            activeKey={tab}
            onSelect={(_event, eventKey) => {
              const next = Number(eventKey)
              if (next !== 1) {
                // Leaving the create workflow drops the one-time secret.
                setCreated(null)
                setCopyState('idle')
              }
              setTab(next)
            }}
            aria-label="My keys"
          >
            <Tab eventKey={0} title="My keys">
              <Card>
                <CardTitle>
                  <div className="pf-keys-card-header">
                    <span>My keys</span>
                    <Button
                      variant="secondary"
                      isDisabled={loading}
                      onClick={() => setReload((value) => value + 1)}
                    >
                      Refresh
                    </Button>
                  </div>
                </CardTitle>
                <CardBody>
                  <Toolbar>
                    <ToolbarContent>
                      <ToolbarItem>
                        <SearchInput
                          value={search}
                          aria-label="Search name or key ID"
                          placeholder="Search name or key ID"
                          onChange={(_event, value) => setSearch(value)}
                          onClear={() => setSearch('')}
                        />
                      </ToolbarItem>
                      <ToolbarGroup>
                        <ToolbarItem>
                          <FormSelect
                            aria-label="Key status"
                            value={statusFilter}
                            onChange={(_event, value) =>
                              setStatusFilter(value as StatusFilter)
                            }
                          >
                            {STATUS_OPTIONS.map((option) => (
                              <FormSelectOption
                                key={option.value}
                                value={option.value}
                                label={option.label}
                              />
                            ))}
                          </FormSelect>
                        </ToolbarItem>
                        <ToolbarItem>
                          <FormSelect
                            aria-label="Rows per page"
                            value={String(pageSize)}
                            onChange={(_event, value) => setPageSize(Number(value))}
                          >
                            {[5, 20, 50].map((size) => (
                              <FormSelectOption
                                key={size}
                                value={String(size)}
                                label={String(size)}
                              />
                            ))}
                          </FormSelect>
                        </ToolbarItem>
                      </ToolbarGroup>
                      <ToolbarItem>
                        <Button variant="secondary" onClick={() => setPage(1)}>
                          Search
                        </Button>
                      </ToolbarItem>
                    </ToolbarContent>
                  </Toolbar>

                  {loading ? (
                    <Bullseye>
                      <Spinner size="lg" aria-label="Loading keys" />
                    </Bullseye>
                  ) : (
                    <>
                      <div className="pf-keys-table-scroll">
                        <Table aria-label="My API keys" variant="compact">
                          <Thead>
                            <Tr>
                              <Th>Name / key ID</Th>
                              <Th>Status</Th>
                              <Th>Expires</Th>
                              <Th>Action</Th>
                            </Tr>
                          </Thead>
                          <Tbody>
                            {pageRows.length === 0 && (
                              <Tr>
                                <Td colSpan={4}>No matching keys.</Td>
                              </Tr>
                            )}
                            {pageRows.map((key) => {
                              const state = keyState(key, now)
                              const expiry = keyExpiry(key)
                              const date = expiry ? new Date(expiry) : null
                              const validDate = date !== null && Number.isFinite(date.getTime())
                              return (
                                <Tr key={key.id}>
                                  <Td>
                                    <div className="pf-keys-name">
                                      <strong>{key.name || 'Unnamed key'}</strong>
                                      <span className="pf-keys-id">{key.id}</span>
                                    </div>
                                  </Td>
                                  <Td>
                                    <Label isCompact color={statusColor(state)}>
                                      {state}
                                    </Label>
                                  </Td>
                                  <Td>
                                    <span className="pf-keys-expiry">
                                      {validDate && date ? `${date.toLocaleString()} — ` : ''}
                                      {remainingLabel(key, now)}
                                    </span>
                                  </Td>
                                  <Td>
                                    {state === 'active' ? (
                                      <Button
                                        variant="secondary"
                                        size="sm"
                                        onClick={() => setRevokeTarget(key)}
                                      >
                                        Revoke
                                      </Button>
                                    ) : (
                                      '—'
                                    )}
                                  </Td>
                                </Tr>
                              )
                            })}
                          </Tbody>
                        </Table>
                      </div>
                      <div className="pf-keys-pager" aria-label="Key pages">
                        <Button
                          variant="secondary"
                          size="sm"
                          isDisabled={currentPage <= 1}
                          onClick={() => setPage((value) => Math.max(1, value - 1))}
                        >
                          Previous
                        </Button>
                        <span aria-live="polite">
                          Page {currentPage} of {pageCount} · {filtered.length} results
                        </span>
                        <Button
                          variant="secondary"
                          size="sm"
                          isDisabled={currentPage >= pageCount}
                          onClick={() => setPage((value) => Math.min(pageCount, value + 1))}
                        >
                          Next
                        </Button>
                      </div>
                      <p className="pf-keys-note">
                        Revoked and expired keys remain in the list for audit. Use the status
                        filter to review them.
                      </p>
                    </>
                  )}
                </CardBody>
              </Card>
            </Tab>

            <Tab eventKey={1} title="Create key">
              <Card>
                <CardTitle>Create key</CardTitle>
                <CardBody>
                  <p className="pf-keys-note">
                    Create a key for a device or AI client. Existing keys remain active until they
                    expire or you revoke them.
                  </p>
                  <Form onSubmit={onCreate}>
                    <FormGroup label="Name" isRequired fieldId="key-name">
                      <TextInput
                        id="key-name"
                        value={createName}
                        maxLength={128}
                        isRequired
                        onChange={(_event, value) => setCreateName(value)}
                      />
                    </FormGroup>
                    <FormGroup label="Lifetime" isRequired fieldId="key-lifetime">
                      <TextInput
                        id="key-lifetime"
                        value={createLifetime}
                        isRequired
                        onChange={(_event, value) => setCreateLifetime(value)}
                      />
                    </FormGroup>
                    <ActionGroup>
                      <Button
                        type="submit"
                        variant="primary"
                        isLoading={creating}
                        isDisabled={creating}
                      >
                        Create key
                      </Button>
                    </ActionGroup>
                  </Form>

                  {created && (
                    <Card isPlain className="pf-keys-reveal">
                      <CardBody>
                        <p>
                          <strong>Key created.</strong> Copy or download it now; it cannot be
                          retrieved later. This panel hides it in 5 minutes. Keep the file private,
                          and clear your clipboard after pasting it into the client.
                        </p>
                        <div className="pf-keys-actions">
                          <Button variant="secondary" onClick={() => void onCopy()}>
                            Copy key
                          </Button>
                          <Button variant="secondary" onClick={onDownload}>
                            Download .key
                          </Button>
                          <Button variant="link" onClick={dismissCreated}>
                            Dismiss key
                          </Button>
                          {copyState === 'copied' && (
                            <>
                              <span className="pf-keys-copied">
                                Copied. Paste it now and clear your clipboard after use.
                              </span>
                              <Button variant="link" isInline onClick={() => void clearClipboard()}>
                                Clear clipboard
                              </Button>
                            </>
                          )}
                        </div>
                      </CardBody>
                    </Card>
                  )}
                </CardBody>
              </Card>
            </Tab>
          </Tabs>
        )}
      </div>

      <Modal
        isOpen={revokeTarget !== null}
        onClose={() => setRevokeTarget(null)}
        variant="small"
        aria-labelledby="pf-keys-revoke-title"
      >
        <ModalHeader title="Revoke key" labelId="pf-keys-revoke-title" />
        <ModalBody>
          <p>
            Revoke <strong>{revokeTarget?.name || revokeTarget?.id}</strong>? Applications using it
            will lose access.
          </p>
        </ModalBody>
        <ModalFooter>
          <Button variant="link" onClick={() => setRevokeTarget(null)}>
            Cancel
          </Button>
          <Button
            variant="danger"
            isLoading={revoking}
            isDisabled={revoking}
            onClick={() => void onRevoke()}
          >
            Revoke
          </Button>
        </ModalFooter>
      </Modal>
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
          API key management is not enabled on this gateway. Contact your administrator if you
          believe this is a mistake.
        </EmptyStateBody>
      </EmptyState>
    </PageSection>
  )
}

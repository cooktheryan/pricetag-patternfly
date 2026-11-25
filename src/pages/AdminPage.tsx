import { useEffect, useMemo, useRef, useState } from 'react'
import type { FormEvent, ReactNode } from 'react'
import {
  Alert,
  Bullseye,
  Button,
  Card,
  CardBody,
  CardTitle,
  DescriptionList,
  DescriptionListDescription,
  DescriptionListGroup,
  DescriptionListTerm,
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
} from '@patternfly/react-core'
import { Table, Tbody, Td, Th, Thead, Tr } from '@patternfly/react-table'
import { useSession } from '../lib/session'
import { impersonateAction } from '../lib/sessionChange'
import { keyFilename } from '../lib/keys'
import type {
  AdminKey,
  BudgetOverride,
  Discounts,
  ModelPolicy,
  PartnerKey,
  PartnerUser,
  PriceRow,
  SafetyNet,
} from '../lib/admin'
import {
  createAdminKey,
  fetchAdminKeys,
  fetchBudgets,
  fetchDiscounts,
  fetchModelPolicies,
  fetchPartnerKeys,
  fetchPartnerUsers,
  fetchPrices,
  fetchSafetyNet,
  partnerName,
  revokeAdminKey,
  updateManagementUser,
  updatePartnerAccess,
} from '../lib/admin'
import '../components/admin/admin.css'

const TABS = [
  { id: 'users', label: 'Users' },
  { id: 'user-keys', label: 'User keys' },
  { id: 'safety-net', label: 'Safety Net' },
  { id: 'user-quota', label: 'User quota' },
  { id: 'model-pricing', label: 'Model pricing' },
  { id: 'discounts', label: 'Discounts' },
  { id: 'restrictions', label: 'Model Restrictions' },
] as const

type TabId = (typeof TABS)[number]['id']

function useAdminData<T>(loader: (signal: AbortSignal) => Promise<T>) {
  const [data, setData] = useState<T | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [updated, setUpdated] = useState<Date | null>(null)
  const [reload, setReload] = useState(0)
  useEffect(() => {
    const controller = new AbortController()
    setLoading(true)
    setError('')
    loader(controller.signal)
      .then((next) => {
        if (!controller.signal.aborted) {
          setData(next)
          setUpdated(new Date())
        }
      })
      .catch((reason: unknown) => {
        if (!controller.signal.aborted) {
          setError(reason instanceof Error ? reason.message : 'Could not load this tab.')
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false)
      })
    return () => controller.abort()
    // loader identity is intentionally excluded; reload drives refreshes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reload])
  return { data, loading, error, updated, reload: () => setReload((value) => value + 1) }
}

function AdminSection({
  title,
  updated,
  loading,
  onRefresh,
  error,
  children,
}: {
  title: string
  updated: Date | null
  loading: boolean
  onRefresh: () => void
  error: string
  children: ReactNode
}) {
  return (
    <Card>
      <CardTitle>
        <div className="pf-admin-header">
          <span>{title}</span>
          <span className="pf-admin-controls">
            {updated && <span className="pf-admin-muted">Updated {updated.toLocaleTimeString()}</span>}
            <Button variant="secondary" isDisabled={loading} onClick={onRefresh}>
              Refresh
            </Button>
          </span>
        </div>
      </CardTitle>
      <CardBody>
        {error && (
          <Alert variant="danger" isInline title="Could not load this tab">
            <p>{error}</p>
          </Alert>
        )}
        {loading && !error ? (
          <Bullseye>
            <Spinner size="lg" aria-label={`Loading ${title}`} />
          </Bullseye>
        ) : (
          children
        )}
      </CardBody>
    </Card>
  )
}

const fmtUsd = (value: number) =>
  `$${Number(value || 0).toLocaleString(undefined, { maximumFractionDigits: 2 })}`
const fmtDate = (value?: string) => {
  if (!value) return '—'
  const date = new Date(value)
  return Number.isFinite(date.getTime()) ? date.toLocaleString() : '—'
}

function UsersTab() {
  const users = useAdminData(fetchPartnerUsers)
  const [subject, setSubject] = useState('')
  const [name, setName] = useState('')
  const [active, setActive] = useState('true')
  const [message, setMessage] = useState('')
  const [actionError, setActionError] = useState('')
  const [savingUser, setSavingUser] = useState(false)
  const [savingId, setSavingId] = useState('')
  const [search, setSearch] = useState('')
  const [stateFilter, setStateFilter] = useState('all')
  const [pageSize, setPageSize] = useState(5)
  const [page, setPage] = useState(1)
  const [detail, setDetail] = useState<PartnerUser | null>(null)
  const [detailKeys, setDetailKeys] = useState<PartnerKey[]>([])
  const [detailLoading, setDetailLoading] = useState(false)
  const [viewAs, setViewAs] = useState<PartnerUser | null>(null)

  const all = users.data ?? []
  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase()
    return all.filter((user) => {
      if (stateFilter === 'active' && !user.active) return false
      if (stateFilter === 'inactive' && user.active) return false
      if (!query) return true
      return [partnerName(user), user.logins.join(' '), user.tags.email || '', user.user_id]
        .join(' ')
        .toLowerCase()
        .includes(query)
    })
  }, [all, search, stateFilter])
  const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize))
  const currentPage = Math.min(page, pageCount)
  const pageRows = filtered.slice((currentPage - 1) * pageSize, currentPage * pageSize)

  useEffect(() => {
    if (!detail) {
      setDetailKeys([])
      return
    }
    const controller = new AbortController()
    setDetailLoading(true)
    fetchPartnerKeys(detail.user_id, controller.signal)
      .then((keys) => {
        if (!controller.signal.aborted) setDetailKeys(keys)
      })
      .catch(() => {
        if (!controller.signal.aborted) setDetailKeys([])
      })
      .finally(() => {
        if (!controller.signal.aborted) setDetailLoading(false)
      })
    return () => controller.abort()
  }, [detail])

  const onSaveUser = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!subject.trim() || !name.trim()) {
      setActionError('Login and name are required.')
      return
    }
    setSavingUser(true)
    setActionError('')
    setMessage('')
    try {
      await updateManagementUser(subject.trim(), name.trim(), active === 'true')
      setMessage('User saved.')
      users.reload()
    } catch (reason) {
      setActionError(reason instanceof Error ? reason.message : 'Could not save the user.')
    } finally {
      setSavingUser(false)
    }
  }

  const onChangeAccess = async (user: PartnerUser, role: string, manager: string) => {
    setSavingId(user.user_id)
    setActionError('')
    try {
      await updatePartnerAccess(user.user_id, role, manager || null)
      users.reload()
    } catch (reason) {
      setActionError(reason instanceof Error ? reason.message : 'Could not update access.')
    } finally {
      setSavingId('')
    }
  }

  return (
    <div className="pf-admin-stack">
      <Card>
        <CardTitle>Create or update a user</CardTitle>
        <CardBody>
          <Form onSubmit={onSaveUser}>
            <div className="pf-admin-form">
              <FormGroup label="Login" isRequired fieldId="admin-user-login">
                <TextInput
                  id="admin-user-login"
                  value={subject}
                  isRequired
                  onChange={(_event, value) => setSubject(value)}
                />
              </FormGroup>
              <FormGroup label="Name" isRequired fieldId="admin-user-name">
                <TextInput
                  id="admin-user-name"
                  value={name}
                  isRequired
                  onChange={(_event, value) => setName(value)}
                />
              </FormGroup>
              <FormGroup label="State" fieldId="admin-user-state">
                <FormSelect
                  id="admin-user-state"
                  value={active}
                  onChange={(_event, value) => setActive(value)}
                >
                  <FormSelectOption value="true" label="Active" />
                  <FormSelectOption value="false" label="Inactive" />
                </FormSelect>
              </FormGroup>
              <Button type="submit" variant="primary" isLoading={savingUser} isDisabled={savingUser}>
                Save user
              </Button>
            </div>
          </Form>
          <p className="pf-admin-muted">
            Creating a user does not create a key. New users start with the user role; set roles
            and managers in the table below. Role and manager changes require a super-admin.
          </p>
          {message && <Alert variant="success" isInline title={message} />}
          {actionError && (
            <Alert variant="danger" isInline title="User operation failed">
              <p>{actionError}</p>
            </Alert>
          )}
        </CardBody>
      </Card>

      <AdminSection
        title="Users"
        updated={users.updated}
        loading={users.loading}
        onRefresh={users.reload}
        error={users.error}
      >
        <div className="pf-admin-toolbar">
          <SearchInput
            value={search}
            aria-label="Search users"
            placeholder="Search login, name, email, or user ID"
            onChange={(_event, value) => {
              setSearch(value)
              setPage(1)
            }}
            onClear={() => setSearch('')}
          />
          <FormSelect
            aria-label="User status"
            value={stateFilter}
            onChange={(_event, value) => {
              setStateFilter(value)
              setPage(1)
            }}
          >
            <FormSelectOption value="all" label="All users" />
            <FormSelectOption value="active" label="Active" />
            <FormSelectOption value="inactive" label="Inactive" />
          </FormSelect>
          <FormSelect
            aria-label="Rows per page"
            value={String(pageSize)}
            onChange={(_event, value) => {
              setPageSize(Number(value))
              setPage(1)
            }}
          >
            {[5, 20, 50].map((size) => (
              <FormSelectOption key={size} value={String(size)} label={String(size)} />
            ))}
          </FormSelect>
        </div>
        <div className="pf-admin-table-scroll">
          <Table aria-label="Partner users" variant="compact">
            <Thead>
              <Tr>
                <Th>User</Th>
                <Th>Login</Th>
                <Th>Manager</Th>
                <Th>Role</Th>
                <Th>Status</Th>
                <Th>Actions</Th>
              </Tr>
            </Thead>
            <Tbody>
              {pageRows.length === 0 && (
                <Tr>
                  <Td colSpan={6}>No matching users.</Td>
                </Tr>
              )}
              {pageRows.map((user) => (
                <Tr key={user.user_id}>
                  <Td>
                    <div className="pf-admin-person">
                      <strong>{partnerName(user)}</strong>
                      <span className="pf-admin-muted">{user.tags.email || user.user_id}</span>
                    </div>
                  </Td>
                  <Td>{user.logins.join(', ') || '—'}</Td>
                  <Td>
                    <FormSelect
                      aria-label={`Manager for ${partnerName(user)}`}
                      value={user.manager_user_id || ''}
                      isDisabled={savingId === user.user_id}
                      onChange={(_event, value) => void onChangeAccess(user, user.role, value)}
                    >
                      <FormSelectOption value="" label="— none —" />
                      {all
                        .filter((manager) => manager.user_id !== user.user_id)
                        .map((manager) => (
                          <FormSelectOption
                            key={manager.user_id}
                            value={manager.user_id}
                            label={partnerName(manager)}
                          />
                        ))}
                    </FormSelect>
                  </Td>
                  <Td>
                    <FormSelect
                      aria-label={`Role for ${partnerName(user)}`}
                      value={user.role}
                      isDisabled={savingId === user.user_id}
                      onChange={(_event, value) =>
                        void onChangeAccess(user, value, user.manager_user_id || '')
                      }
                    >
                      <FormSelectOption value="user" label="user" />
                      <FormSelectOption value="admin" label="admin" />
                      <FormSelectOption value="super_admin" label="super_admin" />
                    </FormSelect>
                  </Td>
                  <Td>
                    <Label isCompact color={user.active ? 'green' : 'grey'}>
                      {user.active ? 'active' : 'inactive'}
                    </Label>
                  </Td>
                  <Td>
                    <div className="pf-admin-actions">
                      <Button
                        variant="secondary"
                        size="sm"
                        isDisabled={!user.logins.length}
                        onClick={() => setViewAs(user)}
                      >
                        View as
                      </Button>
                      <Button variant="link" size="sm" onClick={() => setDetail(user)}>
                        Details
                      </Button>
                    </div>
                  </Td>
                </Tr>
              ))}
            </Tbody>
          </Table>
        </div>
        <div className="pf-admin-pager" aria-label="User pages">
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
      </AdminSection>

      <Modal
        isOpen={detail !== null}
        onClose={() => setDetail(null)}
        variant="medium"
        aria-labelledby="pf-admin-user-detail-title"
      >
        <ModalHeader
          title={detail ? partnerName(detail) : 'User details'}
          labelId="pf-admin-user-detail-title"
        />
        <ModalBody>
          {detail && (
            <>
              <DescriptionList isHorizontal>
                <DescriptionListGroup>
                  <DescriptionListTerm>Logins</DescriptionListTerm>
                  <DescriptionListDescription>
                    {detail.logins.join(', ') || '—'}
                  </DescriptionListDescription>
                </DescriptionListGroup>
                <DescriptionListGroup>
                  <DescriptionListTerm>Email</DescriptionListTerm>
                  <DescriptionListDescription>{detail.tags.email || '—'}</DescriptionListDescription>
                </DescriptionListGroup>
                <DescriptionListGroup>
                  <DescriptionListTerm>Role</DescriptionListTerm>
                  <DescriptionListDescription>{detail.role}</DescriptionListDescription>
                </DescriptionListGroup>
                <DescriptionListGroup>
                  <DescriptionListTerm>User ID</DescriptionListTerm>
                  <DescriptionListDescription>{detail.user_id}</DescriptionListDescription>
                </DescriptionListGroup>
              </DescriptionList>
              <h3 className="pf-admin-subhead">Keys</h3>
              {detailLoading ? (
                <Bullseye>
                  <Spinner size="md" aria-label="Loading user keys" />
                </Bullseye>
              ) : detailKeys.length === 0 ? (
                <p className="pf-admin-muted">No keys for this user.</p>
              ) : (
                <div className="pf-admin-table-scroll">
                  <Table aria-label="User keys" variant="compact">
                    <Thead>
                      <Tr>
                        <Th>Name</Th>
                        <Th>Status</Th>
                        <Th>Expires</Th>
                      </Tr>
                    </Thead>
                    <Tbody>
                      {detailKeys.map((key) => (
                        <Tr key={key.id}>
                          <Td>{key.name || key.id}</Td>
                          <Td>{key.status || 'active'}</Td>
                          <Td>{fmtDate(key.expirationDate || key.expiresAt)}</Td>
                        </Tr>
                      ))}
                    </Tbody>
                  </Table>
                </div>
              )}
            </>
          )}
        </ModalBody>
        <ModalFooter>
          <Button variant="link" onClick={() => setDetail(null)}>
            Close
          </Button>
        </ModalFooter>
      </Modal>

      <Modal
        isOpen={viewAs !== null}
        onClose={() => setViewAs(null)}
        variant="small"
        aria-labelledby="pf-admin-view-as-title"
      >
        <ModalHeader title="Change dashboard view" labelId="pf-admin-view-as-title" />
        <ModalBody>
          {/* Authorization is server-side: HandleImpersonate re-authenticates
              the session, requires a partner super-admin, rejects inactive
              or unknown targets, canonicalizes the login, and enforces
              read-only impersonation. This form is not a boundary. */}
          <Form
            id="pf-admin-view-as-form"
            action={viewAs ? impersonateAction(viewAs.logins[0]) : impersonateAction()}
            method="post"
          >
            <p>
              View as {viewAs ? partnerName(viewAs) : ''}? This is read-only; keys and settings
              cannot be changed while viewing as another user.
            </p>
          </Form>
        </ModalBody>
        <ModalFooter>
          <Button variant="link" onClick={() => setViewAs(null)}>
            Cancel
          </Button>
          <Button variant="primary" type="submit" form="pf-admin-view-as-form">
            Continue
          </Button>
        </ModalFooter>
      </Modal>
    </div>
  )
}

function UserKeysTab() {
  const users = useAdminData(fetchPartnerUsers)
  const keys = useAdminData(fetchAdminKeys)
  const [username, setUsername] = useState('')
  const [group, setGroup] = useState('system:authenticated')
  const [keyName, setKeyName] = useState('onboarding')
  const [lifetime, setLifetime] = useState('30d')
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  // Deliver the mint secret from a closure-like ref, never React state or
  // rendered markup. The gateway returns it once; only Copy/Download read it.
  const secretRef = useRef<{ key: string; id: string; name: string; username: string } | null>(null)
  const [hasSecret, setHasSecret] = useState(false)
  const [copyState, setCopyState] = useState<'idle' | 'copied'>('idle')
  const [revokeTarget, setRevokeTarget] = useState<AdminKey | null>(null)
  const [revoking, setRevoking] = useState(false)

  useEffect(() => {
    if (!hasSecret) return
    const timer = setTimeout(() => {
      secretRef.current = null
      setHasSecret(false)
      setCopyState('idle')
    }, 5 * 60_000)
    return () => clearTimeout(timer)
  }, [hasSecret])

  useEffect(() => {
    const clear = () => {
      secretRef.current = null
      setHasSecret(false)
    }
    window.addEventListener('pagehide', clear)
    return () => {
      window.removeEventListener('pagehide', clear)
      clear()
    }
  }, [])

  const options = (users.data ?? []).flatMap((user) =>
    user.logins.length ? user.logins.map((login) => ({ login, name: partnerName(user) })) : [],
  )

  const onIssue = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!username) {
      setError('Choose a user.')
      return
    }
    if (!keyName.trim()) {
      setError('Key name is required.')
      return
    }
    if (!/^[0-9]{1,4}[smhd]$/.test(lifetime.trim())) {
      setError('Lifetime must be a duration like 30d, 12h, or 45m.')
      return
    }
    setCreating(true)
    setError('')
    setMessage('')
    try {
      const result = await createAdminKey(username, group.trim(), keyName.trim(), lifetime.trim())
      secretRef.current = { ...result, name: keyName.trim(), username }
      setHasSecret(true)
      setCopyState('idle')
      keys.reload()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not issue the key.')
    } finally {
      setCreating(false)
    }
  }

  const onCopy = async () => {
    const secret = secretRef.current
    if (!secret) return
    try {
      await navigator.clipboard.writeText(secret.key)
      setCopyState('copied')
    } catch {
      setError('Clipboard access was denied. Use Download .key instead.')
    }
  }

  const onDownload = () => {
    const secret = secretRef.current
    if (!secret) return
    const url = URL.createObjectURL(new Blob([`${secret.key}\n`], { type: 'text/plain' }))
    const link = document.createElement('a')
    link.href = url
    link.download = keyFilename(secret.username, secret.name)
    try {
      document.body.append(link)
      link.click()
    } finally {
      link.remove()
      setTimeout(() => URL.revokeObjectURL(url), 1000)
    }
  }

  const onRevoke = async () => {
    if (!revokeTarget) return
    setRevoking(true)
    setError('')
    try {
      await revokeAdminKey(revokeTarget.id)
      setMessage('Key revoked.')
      setRevokeTarget(null)
      keys.reload()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not revoke the key.')
      setRevokeTarget(null)
    } finally {
      setRevoking(false)
    }
  }

  return (
    <div className="pf-admin-stack">
      <Card>
        <CardTitle>Issue onboarding key</CardTitle>
        <CardBody>
          <p className="pf-admin-muted">
            Each submission creates an additional key; existing keys remain valid. Send the key
            privately to the selected user for sign-in and inference.
          </p>
          <Form onSubmit={onIssue}>
            <div className="pf-admin-form">
              <FormGroup label="User" isRequired fieldId="admin-key-user">
                <FormSelect
                  id="admin-key-user"
                  value={username}
                  onChange={(_event, value) => setUsername(value)}
                >
                  <FormSelectOption value="" label="Select a user" />
                  {options.map((entry) => (
                    <FormSelectOption
                      key={entry.login}
                      value={entry.login}
                      label={`${entry.name} (${entry.login})`}
                    />
                  ))}
                </FormSelect>
              </FormGroup>
              <FormGroup label="Key name" isRequired fieldId="admin-key-name">
                <TextInput
                  id="admin-key-name"
                  value={keyName}
                  maxLength={128}
                  isRequired
                  onChange={(_event, value) => setKeyName(value)}
                />
              </FormGroup>
              <FormGroup label="Group" isRequired fieldId="admin-key-group">
                <TextInput
                  id="admin-key-group"
                  value={group}
                  isRequired
                  onChange={(_event, value) => setGroup(value)}
                />
              </FormGroup>
              <FormGroup label="Lifetime" isRequired fieldId="admin-key-lifetime">
                <TextInput
                  id="admin-key-lifetime"
                  value={lifetime}
                  isRequired
                  onChange={(_event, value) => setLifetime(value)}
                />
              </FormGroup>
              <Button type="submit" variant="primary" isLoading={creating} isDisabled={creating}>
                Issue key
              </Button>
            </div>
          </Form>
          {error && (
            <Alert variant="danger" isInline title="Key operation failed">
              <p>{error}</p>
            </Alert>
          )}
          {message && <Alert variant="success" isInline title={message} />}
          {hasSecret && (
            <Card isPlain className="pf-admin-reveal">
              <CardBody>
                <p>
                  <strong>Key created.</strong> Copy or download it now; it cannot be retrieved
                  later. This panel hides it in 5 minutes.
                </p>
                <div className="pf-admin-actions">
                  <Button variant="secondary" onClick={() => void onCopy()}>
                    Copy key
                  </Button>
                  <Button variant="secondary" onClick={onDownload}>
                    Download .key
                  </Button>
                  <Button
                    variant="link"
                    onClick={() => {
                      secretRef.current = null
                      setHasSecret(false)
                      setCopyState('idle')
                    }}
                  >
                    Dismiss key
                  </Button>
                  {copyState === 'copied' && (
                    <span className="pf-admin-muted">Copied. Clear your clipboard after use.</span>
                  )}
                </div>
              </CardBody>
            </Card>
          )}
        </CardBody>
      </Card>

      <AdminSection
        title="API keys"
        updated={keys.updated}
        loading={keys.loading}
        onRefresh={keys.reload}
        error={keys.error}
      >
        <div className="pf-admin-table-scroll">
          <Table aria-label="All API keys" variant="compact">
            <Thead>
              <Tr>
                <Th>Username</Th>
                <Th>Key name</Th>
                <Th>Status</Th>
                <Th>Created</Th>
                <Th>Expires</Th>
                <Th>Action</Th>
              </Tr>
            </Thead>
            <Tbody>
              {(keys.data ?? []).length === 0 && (
                <Tr>
                  <Td colSpan={6}>No API keys found.</Td>
                </Tr>
              )}
              {(keys.data ?? []).map((key) => (
                <Tr key={key.id}>
                  <Td>{key.username || '—'}</Td>
                  <Td>{key.name || key.id}</Td>
                  <Td>
                    <Label isCompact color={key.status === 'revoked' ? 'red' : 'green'}>
                      {key.status || 'active'}
                    </Label>
                  </Td>
                  <Td>{fmtDate(key.creationDate)}</Td>
                  <Td>{fmtDate(key.expirationDate || key.expiresAt)}</Td>
                  <Td>
                    {key.status === 'revoked' ? (
                      '—'
                    ) : (
                      <Button variant="secondary" size="sm" onClick={() => setRevokeTarget(key)}>
                        Revoke
                      </Button>
                    )}
                  </Td>
                </Tr>
              ))}
            </Tbody>
          </Table>
        </div>
      </AdminSection>

      <Modal
        isOpen={revokeTarget !== null}
        onClose={() => setRevokeTarget(null)}
        variant="small"
        aria-labelledby="pf-admin-revoke-title"
      >
        <ModalHeader title="Revoke key" labelId="pf-admin-revoke-title" />
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
    </div>
  )
}

function SafetyNetTab() {
  const policy = useAdminData(fetchSafetyNet)
  const data: SafetyNet | null = policy.data
  return (
    <AdminSection
      title="Monthly Safety Net"
      updated={policy.updated}
      loading={policy.loading}
      onRefresh={policy.reload}
      error={policy.error}
    >
      {!data ? (
        <p className="pf-admin-muted">No policy loaded.</p>
      ) : (
        <DescriptionList isHorizontal>
          <DescriptionListGroup>
            <DescriptionListTerm>Default monthly USD</DescriptionListTerm>
            <DescriptionListDescription>{fmtUsd(data.default_monthly_usd)}</DescriptionListDescription>
          </DescriptionListGroup>
          <DescriptionListGroup>
            <DescriptionListTerm>Enforced</DescriptionListTerm>
            <DescriptionListDescription>{data.enforced ? 'yes' : 'no'}</DescriptionListDescription>
          </DescriptionListGroup>
          <DescriptionListGroup>
            <DescriptionListTerm>Allowed over-limit models</DescriptionListTerm>
            <DescriptionListDescription>
              {data.allowed_over_limit_models.length
                ? data.allowed_over_limit_models.join(', ')
                : '—'}
            </DescriptionListDescription>
          </DescriptionListGroup>
          <DescriptionListGroup>
            <DescriptionListTerm>Updated</DescriptionListTerm>
            <DescriptionListDescription>{fmtDate(data.updated_at)}</DescriptionListDescription>
          </DescriptionListGroup>
        </DescriptionList>
      )}
    </AdminSection>
  )
}

function QuotaTab() {
  const budgets = useAdminData(fetchBudgets)
  const rows: BudgetOverride[] = budgets.data ?? []
  return (
    <AdminSection
      title="Per-user monthly quota overrides"
      updated={budgets.updated}
      loading={budgets.loading}
      onRefresh={budgets.reload}
      error={budgets.error}
    >
      <div className="pf-admin-table-scroll">
        <Table aria-label="Quota overrides" variant="compact">
          <Thead>
            <Tr>
              <Th>User</Th>
              <Th className="pf-admin-num">Monthly USD</Th>
              <Th>Updated</Th>
            </Tr>
          </Thead>
          <Tbody>
            {rows.length === 0 && (
              <Tr>
                <Td colSpan={3}>No overrides; everyone uses the global default.</Td>
              </Tr>
            )}
            {rows.map((row) => (
              <Tr key={row.principal}>
                <Td>{row.principal}</Td>
                <Td className="pf-admin-num">{fmtUsd(row.monthly_usd)}</Td>
                <Td>{fmtDate(row.updated_at)}</Td>
              </Tr>
            ))}
          </Tbody>
        </Table>
      </div>
    </AdminSection>
  )
}

function PricingTab() {
  const prices = useAdminData(fetchPrices)
  const [search, setSearch] = useState('')
  const rows = useMemo(() => {
    const query = search.trim().toLowerCase()
    return (prices.data ?? [])
      .filter((row) => !query || `${row.Model} ${row.Provider}`.toLowerCase().includes(query))
      .slice(0, 100)
  }, [prices.data, search])
  return (
    <AdminSection
      title="Model pricing"
      updated={prices.updated}
      loading={prices.loading}
      onRefresh={prices.reload}
      error={prices.error}
    >
      <div className="pf-admin-toolbar">
        <SearchInput
          value={search}
          aria-label="Search model or provider"
          placeholder="Search model or provider"
          onChange={(_event, value) => setSearch(value)}
          onClear={() => setSearch('')}
        />
        <span className="pf-admin-muted">
          {(prices.data ?? []).length} rates · showing up to 100
        </span>
      </div>
      <div className="pf-admin-table-scroll">
        <Table aria-label="Model prices" variant="compact">
          <Thead>
            <Tr>
              <Th>Model</Th>
              <Th>Provider</Th>
              <Th className="pf-admin-num">Input</Th>
              <Th className="pf-admin-num">Output</Th>
              <Th className="pf-admin-num">Cache write</Th>
              <Th className="pf-admin-num">Cache read</Th>
              <Th>Managed</Th>
            </Tr>
          </Thead>
          <Tbody>
            {rows.length === 0 && (
              <Tr>
                <Td colSpan={7}>No model rates match.</Td>
              </Tr>
            )}
            {rows.map((row: PriceRow) => (
              <Tr key={`${row.Provider}/${row.Model}`}>
                <Td>{row.Model}</Td>
                <Td>{row.Provider}</Td>
                <Td className="pf-admin-num">{row.InputCost}</Td>
                <Td className="pf-admin-num">{row.OutputCost}</Td>
                <Td className="pf-admin-num">{row.CacheWriteCost}</Td>
                <Td className="pf-admin-num">{row.CacheReadCost}</Td>
                <Td>{row.Managed ? 'yes' : 'no'}</Td>
              </Tr>
            ))}
          </Tbody>
        </Table>
      </div>
    </AdminSection>
  )
}

function DiscountsTab() {
  const discounts = useAdminData(fetchDiscounts)
  const data: Discounts | null = discounts.data
  return (
    <AdminSection
      title="Pricing discounts"
      updated={discounts.updated}
      loading={discounts.loading}
      onRefresh={discounts.reload}
      error={discounts.error}
    >
      <p className="pf-admin-muted">Version: {data?.version || '—'}</p>
      <div className="pf-admin-table-scroll">
        <Table aria-label="Pricing discounts" variant="compact">
          <Thead>
            <Tr>
              <Th>Rule</Th>
              <Th>Provider</Th>
              <Th>Model prefix</Th>
              <Th className="pf-admin-num">Multiplier</Th>
            </Tr>
          </Thead>
          <Tbody>
            {(data?.rules ?? []).length === 0 && (
              <Tr>
                <Td colSpan={4}>No discount rules.</Td>
              </Tr>
            )}
            {(data?.rules ?? []).map((rule) => (
              <Tr key={rule.name}>
                <Td>{rule.name}</Td>
                <Td>{rule.provider || '—'}</Td>
                <Td>{rule.model_prefix || '—'}</Td>
                <Td className="pf-admin-num">{rule.multiplier}</Td>
              </Tr>
            ))}
          </Tbody>
        </Table>
      </div>
    </AdminSection>
  )
}

function RestrictionsTab() {
  const policies = useAdminData(fetchModelPolicies)
  const rows: ModelPolicy[] = policies.data ?? []
  return (
    <AdminSection
      title="Model restrictions"
      updated={policies.updated}
      loading={policies.loading}
      onRefresh={policies.reload}
      error={policies.error}
    >
      <div className="pf-admin-table-scroll">
        <Table aria-label="Model restrictions" variant="compact">
          <Thead>
            <Tr>
              <Th>User</Th>
              <Th>Status</Th>
              <Th>Allowed models</Th>
              <Th>Updated by</Th>
              <Th>Updated</Th>
            </Tr>
          </Thead>
          <Tbody>
            {rows.length === 0 && (
              <Tr>
                <Td colSpan={5}>No externally restricted users.</Td>
              </Tr>
            )}
            {rows.map((row, index) => (
              <Tr key={row.user_id || `${row.name}-${index}`}>
                <Td>
                  <div className="pf-admin-person">
                    <strong>{row.name || row.email || row.user_id}</strong>
                    <span className="pf-admin-muted">{row.email || ''}</span>
                  </div>
                </Td>
                <Td>
                  <Label isCompact color={row.active ? 'green' : 'grey'}>
                    {row.active ? 'active' : 'inactive'}
                  </Label>
                </Td>
                <Td>{row.deny_all ? 'deny-all' : row.models.join(', ') || '—'}</Td>
                <Td>{row.updated_by || '—'}</Td>
                <Td>{fmtDate(row.updated_at)}</Td>
              </Tr>
            ))}
          </Tbody>
        </Table>
      </div>
    </AdminSection>
  )
}

/** Phase 6: administrator console (`/admin`). */
export function AdminPage() {
  const { who } = useSession()
  const [tab, setTab] = useState(0)
  const active: TabId = TABS[tab]?.id ?? 'users'

  if (!who?.isSuperAdmin) {
    return (
      <PageSection>
        <Alert variant="danger" isInline title="Administrator access required" />
      </PageSection>
    )
  }

  return (
    <PageSection>
      <div className="pf-admin-page">
        <header>
          <Title headingLevel="h1" size="2xl">
            Admin
          </Title>
          <p className="pf-admin-muted">
            User access, keys, budgets, and model policy for this PriceTag deployment.
          </p>
        </header>
        <Tabs
          activeKey={tab}
          onSelect={(_event, key) => setTab(Number(key))}
          aria-label="Admin sections"
        >
          {TABS.map((entry) => (
            <Tab key={entry.id} eventKey={TABS.indexOf(entry)} title={entry.label} />
          ))}
        </Tabs>
        {active === 'users' && <UsersTab />}
        {active === 'user-keys' && <UserKeysTab />}
        {active === 'safety-net' && <SafetyNetTab />}
        {active === 'user-quota' && <QuotaTab />}
        {active === 'model-pricing' && <PricingTab />}
        {active === 'discounts' && <DiscountsTab />}
        {active === 'restrictions' && <RestrictionsTab />}
      </div>
    </PageSection>
  )
}

import { useCallback, useEffect, useRef, useState } from 'react'
import {
  Alert,
  Button,
  Card,
  CardBody,
  CardTitle,
  Form,
  Grid,
  GridItem,
  Modal,
  ModalBody,
  ModalFooter,
  ModalHeader,
  PageSection,
  Title,
  ToggleGroup,
  ToggleGroupItem,
} from '@patternfly/react-core'
import { useSession } from '../lib/session'
import type {
  DashboardData,
  DashboardFilters,
  ModelRow,
  PieMetric,
  ToolMetric,
  UserMetric,
  UserRow,
} from '../lib/dashboard'
import {
  COLORS,
  OTHER_SLICE_COLOR,
  fetchChartUsers,
  fetchDashboard,
  fmtN,
  isHostedModel,
  pieFmt,
  pieVal,
  rangeBounds,
  topFiveItems,
  toolColor,
} from '../lib/dashboard'
import { impersonateAction } from '../lib/sessionChange'
import { BudgetBanner } from '../components/dashboard/BudgetBanner'
import { FilterBar } from '../components/dashboard/FilterBar'
import { KpiCards } from '../components/dashboard/KpiCards'
import { DonutCard } from '../components/dashboard/DonutCard'
import type { DonutDatum } from '../components/dashboard/DonutCard'
import { RecentActivityTable } from '../components/dashboard/RecentActivityTable'
import '../components/dashboard/dashboard.css'

const INITIAL_BOUNDS = rangeBounds('mtd')

const INITIAL_FILTERS: DashboardFilters = {
  range: 'mtd',
  customFrom: INITIAL_BOUNDS.from,
  customTo: INITIAL_BOUNDS.to,
  modelFilter: '',
  userFilter: [],
}

type ViewDialog = { mode: 'self'; as: string } | { mode: 'return' }

function metricUnit(metric: PieMetric): string {
  if (metric === 'tokens') return ' tokens'
  if (metric === 'requests') return ' reqs'
  return ''
}

function toolMetricLabel(metric: ToolMetric): string {
  if (metric === 'users') return 'Users'
  if (metric === 'requests') return 'Requests'
  return 'Tokens'
}

function toolMetricValue(row: { requests: number; users: number; total_tokens: number }, metric: ToolMetric) {
  if (metric === 'users') return row.users
  if (metric === 'requests') return row.requests
  return row.total_tokens
}

/**
 * Usage dashboard (`/dashboard`), administrator-only like the legacy page.
 *
 * The page issues one refresh round over the dashboard API and keeps the
 * previous data visible when a round fails, exactly like the old page: the
 * header reports the failure and the Refresh button retries. An unforced
 * round with the same filters as one already in flight is skipped so the
 * 30-second poll cannot stack behind a slow backend.
 */
export function DashboardPage() {
  const { who } = useSession()
  const isAdmin = who?.isAdmin === true || who?.isSuperAdmin === true
  const isSuperAdmin = who?.isSuperAdmin === true

  const [filters, setFilters] = useState<DashboardFilters>(INITIAL_FILTERS)
  const [savingsRef, setSavingsRef] = useState('claude-opus-4-8')
  const [data, setData] = useState<DashboardData | null>(null)
  const [chartUsers, setChartUsers] = useState<UserRow[]>([])
  const [modelMetric, setModelMetric] = useState<PieMetric>('tokens')
  const [toolMetric, setToolMetric] = useState<ToolMetric>('tokens')
  const [userMetric, setUserMetric] = useState<UserMetric>('cost')
  const [refreshing, setRefreshing] = useState(false)
  const [loadError, setLoadError] = useState(false)
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null)
  const [viewDialog, setViewDialog] = useState<ViewDialog | null>(null)

  const generation = useRef(0)
  const chartGeneration = useRef(0)
  const inFlight = useRef(false)
  const inFlightFingerprint = useRef('')
  const abortRef = useRef<AbortController | null>(null)
  // The full refresh reads the current ranking metric without making the
  // metric a dependency of refresh() — changing it only refetches the By
  // User chart, it does not reload the whole page.
  const userMetricRef = useRef<UserMetric>(userMetric)
  useEffect(() => {
    userMetricRef.current = userMetric
  }, [userMetric])

  const refresh = useCallback(
    async (force: boolean) => {
      const fingerprint = JSON.stringify([filters, savingsRef])
      if (!force && inFlight.current && inFlightFingerprint.current === fingerprint) return
      inFlightFingerprint.current = fingerprint
      inFlight.current = true
      // A superseding round cancels the previous one's HTTP reads instead of
      // leaving them to run out their 30-second timeouts.
      abortRef.current?.abort()
      const controller = new AbortController()
      abortRef.current = controller
      const generationAtStart = ++generation.current
      const chartGenerationAtStart = ++chartGeneration.current
      if (force) setRefreshing(true)
      try {
        const next = await fetchDashboard({
          filters,
          isAdmin,
          savingsRef,
          userMetric: userMetricRef.current,
          fresh: force,
          signal: controller.signal,
        })
        if (generationAtStart !== generation.current) return
        setData(next)
        if (chartGenerationAtStart === chartGeneration.current) setChartUsers(next.chartUsers)
        setLoadError(false)
        setLastUpdated(new Date())
      } catch {
        if (controller.signal.aborted || generationAtStart !== generation.current) return
        setLoadError(true)
      } finally {
        // Whichever round owns the controller clears the shared state; a
        // superseded round must not clear the newer one's in-flight flag.
        if (abortRef.current === controller) {
          abortRef.current = null
          inFlight.current = false
          setRefreshing(false)
        }
      }
    },
    [filters, savingsRef, isAdmin],
  )

  useEffect(() => {
    return () => {
      const controller = abortRef.current
      abortRef.current = null
      controller?.abort()
    }
  }, [])

  useEffect(() => {
    void refresh(false)
  }, [refresh])

  useEffect(() => {
    const id = setInterval(() => {
      void refresh(false)
    }, 30_000)
    return () => clearInterval(id)
  }, [refresh])

  const refreshUserChart = useCallback(
    async (metric: UserMetric) => {
      const generationAtStart = ++chartGeneration.current
      try {
        const rows = await fetchChartUsers(filters, metric)
        if (generationAtStart === chartGeneration.current) setChartUsers(rows)
      } catch {
        // Keep the previous chart; the next refresh round will retry.
      }
    },
    [filters],
  )

  const changeUserMetric = (metric: UserMetric) => {
    setUserMetric(metric)
    void refreshUserChart(metric)
  }

  const clearAll = () => {
    const bounds = rangeBounds('mtd')
    setFilters({
      range: 'mtd',
      customFrom: bounds.from,
      customTo: bounds.to,
      modelFilter: '',
      userFilter: [],
    })
  }

  const models: ModelRow[] = data?.models ?? []
  const tools = data?.tools ?? []

  // Hosted vs vendor splits raw token counts, not prices: a token count
  // needs no pricing arithmetic to agree with the server's saved figure.
  // The deployed pie deliberately uses the model-filtered set, so picking a
  // model narrows this chart too; `catalogModels` only feeds the filter
  // dropdown (never this split).
  const totalTokens = models.reduce((sum, model) => sum + model.total_tokens, 0)
  const hostedTokens = models.reduce(
    (sum, model) => sum + (isHostedModel(model) && model.total_tokens > 0 ? model.total_tokens : 0),
    0,
  )
  const vendorTokens = Math.max(totalTokens - hostedTokens, 0)
  const savingsData: DonutDatum[] = [
    {
      label: 'Hosted',
      legend: `Hosted — ${fmtN(hostedTokens)}`,
      value: hostedTokens,
      color: '#3fb950',
    },
    {
      label: 'Vendor',
      legend: `Vendor — ${fmtN(vendorTokens)}`,
      value: vendorTokens,
      color: '#d29922',
    },
  ]

  const modelPie = topFiveItems(
    models,
    (model) => pieVal(model, modelMetric),
    (model) => model.model,
    9,
  )
  const modelData: DonutDatum[] = modelPie.map((slice, index) => ({
    label: slice.label,
    legend: `${slice.label} — ${pieFmt(slice.value, modelMetric)}`,
    value: slice.value,
    color: COLORS[index % COLORS.length],
  }))

  const existingOther = tools
    .filter((tool) => tool.tool === 'Other')
    .reduce((sum, tool) => sum + toolMetricValue(tool, toolMetric), 0)
  const toolPie = topFiveItems(
    tools.filter((tool) => tool.tool !== 'Other' && toolMetricValue(tool, toolMetric) > 0),
    (tool) => toolMetricValue(tool, toolMetric),
    (tool) => tool.tool,
    5,
  )
  let otherTool: { item: null; label: string; value: number } = {
    item: null,
    label: 'Other',
    value: 0,
  }
  if (toolPie.length && toolPie[toolPie.length - 1].label === 'Other') {
    otherTool = toolPie.pop() as { item: null; label: string; value: number }
  }
  otherTool.value += existingOther
  if (otherTool.value > 0) toolPie.push(otherTool)
  const toolData: DonutDatum[] = toolPie.map((slice) => ({
    label: slice.label,
    legend: `${slice.label} — ${fmtN(slice.value)}`,
    value: slice.value,
    color: slice.item ? toolColor(slice.item.tool) : OTHER_SLICE_COLOR,
  }))

  const userPie = topFiveItems(
    chartUsers,
    (row) => pieVal(row, userMetric),
    (row) => row.display_name || row.username,
  ).slice(0, 5)
  const userData: DonutDatum[] = userPie.map((slice, index) => ({
    label: slice.label,
    legend: `${slice.label} — ${
      userMetric === 'cost' && slice.value === 0 ? 'Free' : pieFmt(slice.value, userMetric)
    }`,
    value: slice.value,
    color: COLORS[index % COLORS.length],
  }))

  const userUnit = userMetric === 'cost' ? '' : metricUnit(userMetric)
  const toolUnit = toolMetric === 'tokens' ? ' tokens' : toolMetric === 'requests' ? ' requests' : ' users'

  const viewAction = impersonateAction(viewDialog?.mode === 'self' ? viewDialog.as : undefined)

  return (
    <PageSection>
      <div className="pf-dashboard-page">
        <header className="pf-dashboard-header">
          <Title headingLevel="h1" size="2xl">
            Usage
          </Title>
          <div className="pf-dashboard-header-actions">
            {loadError ? (
              <span className="pf-dashboard-error" role="status" aria-live="polite">
                Usage could not be loaded. Select Refresh to retry.
              </span>
            ) : (
              lastUpdated && (
                <span className="pf-dashboard-updated" role="status" aria-live="polite">
                  Updated{' '}
                  {lastUpdated.toLocaleTimeString([], {
                    hour: 'numeric',
                    minute: '2-digit',
                    second: '2-digit',
                  })}
                </span>
              )
            )}
            <Button variant="secondary" isDisabled={refreshing} onClick={() => void refresh(true)}>
              {refreshing ? 'Refreshing…' : 'Refresh'}
            </Button>
            {isSuperAdmin && who?.user && (
              <Button
                variant="link"
                onClick={() => setViewDialog({ mode: 'self', as: who.user })}
              >
                My view as user
              </Button>
            )}
          </div>
        </header>

        {who?.impersonating && (
          <Alert
            variant="warning"
            isInline
            title={
              <span>
                Viewing as{' '}
                <strong>
                  {who.display_name ? `${who.display_name} (${who.user})` : who.user}
                </strong>
                {who.real_user && (
                  <>
                    {' '}
                    (you are{' '}
                    {who.real_user_display
                      ? `${who.real_user_display} (${who.real_user})`
                      : who.real_user}
                    )
                  </>
                )}
              </span>
            }
            actionLinks={
              <Button variant="link" isInline onClick={() => setViewDialog({ mode: 'return' })}>
                Back to admin view
              </Button>
            }
          />
        )}

        {who?.managementEnabled && who.quota && <BudgetBanner quota={who.quota} />}

        <FilterBar
          filters={filters}
          isAdmin={isAdmin}
          models={data?.catalogModels ?? []}
          users={data?.rosterUsers ?? []}
          onChange={setFilters}
          onClear={clearAll}
        />

        <KpiCards
          overview={data?.overview ?? null}
          savingsRef={savingsRef}
          onSavingsRefChange={setSavingsRef}
        />

        <Grid hasGutter md={6} lg={3}>
          <GridItem>
            <DonutCard
              title="Token Usage · Hosted vs Vendor"
              ariaTitle="Token usage, hosted versus vendor"
              ariaDesc="Share of tokens served by hosted models versus vendor APIs"
              data={savingsData}
              formatValue={fmtN}
              unit=" tokens"
            />
          </GridItem>
          <GridItem>
            <DonutCard
              title="By Model"
              ariaTitle="Usage by model"
              ariaDesc="Token, cost, or request share by model"
              data={modelData}
              formatValue={(value) => pieFmt(value, modelMetric)}
              unit={metricUnit(modelMetric)}
              footer={
                <ToggleGroup aria-label="Model metric" isCompact>
                  <ToggleGroupItem
                    text="Cost"
                    isSelected={modelMetric === 'cost'}
                    onChange={() => setModelMetric('cost')}
                  />
                  <ToggleGroupItem
                    text="Tokens"
                    isSelected={modelMetric === 'tokens'}
                    onChange={() => setModelMetric('tokens')}
                  />
                  <ToggleGroupItem
                    text="Requests"
                    isSelected={modelMetric === 'requests'}
                    onChange={() => setModelMetric('requests')}
                  />
                </ToggleGroup>
              }
            />
          </GridItem>
          <GridItem>
            <DonutCard
              title={`By Tool (${toolMetricLabel(toolMetric)})`}
              ariaTitle="Usage by tool"
              ariaDesc="Token, request, or user share by client tool"
              data={toolData}
              formatValue={fmtN}
              unit={toolUnit}
              showPercent={toolMetric !== 'users'}
              footer={
                <ToggleGroup aria-label="Tool metric" isCompact>
                  <ToggleGroupItem
                    text="Tokens"
                    isSelected={toolMetric === 'tokens'}
                    onChange={() => setToolMetric('tokens')}
                  />
                  <ToggleGroupItem
                    text="Requests"
                    isSelected={toolMetric === 'requests'}
                    onChange={() => setToolMetric('requests')}
                  />
                  <ToggleGroupItem
                    text="Users"
                    isSelected={toolMetric === 'users'}
                    onChange={() => setToolMetric('users')}
                  />
                </ToggleGroup>
              }
            />
          </GridItem>
          <GridItem>
            <DonutCard
              title="By User (Top 5)"
              ariaTitle="Usage by user"
              ariaDesc="Top five users by cost, tokens, or requests"
              data={userData}
              formatValue={(value) =>
                userMetric === 'cost' && value === 0 ? 'Free' : pieFmt(value, userMetric)
              }
              unit={userUnit}
              footer={
                <ToggleGroup aria-label="User metric" isCompact>
                  <ToggleGroupItem
                    text="Cost"
                    isSelected={userMetric === 'cost'}
                    onChange={() => changeUserMetric('cost')}
                  />
                  <ToggleGroupItem
                    text="Tokens"
                    isSelected={userMetric === 'tokens'}
                    onChange={() => changeUserMetric('tokens')}
                  />
                  <ToggleGroupItem
                    text="Requests"
                    isSelected={userMetric === 'requests'}
                    onChange={() => changeUserMetric('requests')}
                  />
                </ToggleGroup>
              }
            />
          </GridItem>
        </Grid>

        <Card className="pf-dashboard-recent">
          <CardTitle>
            Recent Activity <span className="pf-dashboard-muted">(live)</span>
          </CardTitle>
          <CardBody>
            <RecentActivityTable rows={data?.recent ?? []} />
          </CardBody>
        </Card>
      </div>

      <Modal
        isOpen={viewDialog !== null}
        onClose={() => setViewDialog(null)}
        variant="small"
        aria-labelledby="dashboard-view-title"
        aria-describedby="dashboard-view-description"
      >
        <ModalHeader title="Change dashboard view" labelId="dashboard-view-title" />
        <ModalBody>
          {/* The session-change POST and its CSRF boundary are documented in
              lib/sessionChange.ts (gateway Origin + Sec-Fetch-Site checks,
              HttpOnly SameSite=Lax session cookie). */}
          <Form id="dashboard-view-form" action={viewAction} method="post">
            <p id="dashboard-view-description">
              {viewDialog?.mode === 'self'
                ? `View personal usage as ${viewDialog.as}?`
                : 'Return to your administrator dashboard?'}
            </p>
            {viewDialog?.mode === 'self' && (
              <>
                {/* The gateway reads `as` from the query string (the legacy
                    confirmation form does the same); the hidden field keeps
                    the operation working for a body-reading handler. */}
                <input type="hidden" name="as" value={viewDialog.as} />
                <p className="pf-dashboard-muted">
                  Read-only: keys and settings cannot be changed while viewing as a user. This
                  changes the dashboard view in all tabs sharing this browser session.
                </p>
              </>
            )}
          </Form>
        </ModalBody>
        <ModalFooter>
          <Button variant="link" type="button" onClick={() => setViewDialog(null)}>
            Cancel
          </Button>
          <Button variant="primary" type="submit" form="dashboard-view-form">
            Continue
          </Button>
        </ModalFooter>
      </Modal>
    </PageSection>
  )
}

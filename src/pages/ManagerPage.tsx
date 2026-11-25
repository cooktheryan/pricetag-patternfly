import { useEffect, useMemo, useRef, useState } from 'react'
import {
  Alert,
  Bullseye,
  Button,
  Card,
  CardBody,
  CardTitle,
  FormSelect,
  FormSelectOption,
  Grid,
  GridItem,
  Label,
  Menu,
  MenuContent,
  MenuItem,
  MenuList,
  MenuSearch,
  MenuSearchInput,
  MenuToggle,
  Modal,
  ModalBody,
  ModalFooter,
  ModalHeader,
  PageSection,
  Popper,
  SearchInput,
  Spinner,
  Title,
  ToggleGroup,
  ToggleGroupItem,
} from '@patternfly/react-core'
import { Table, Tbody, Td, Th, Thead, Tr } from '@patternfly/react-table'
import {
  Chart,
  ChartAxis,
  ChartGroup,
  ChartLine,
  ChartVoronoiContainer,
} from '@patternfly/react-charts/victory'
import { useSession } from '../lib/session'
import { COLORS, SAVINGS_REF_OPTIONS } from '../lib/dashboard'
import type { PieMetric } from '../lib/manager'
import {
  fetchCharts,
  fetchPerson,
  fetchScope,
  fetchSelfCharts,
  fetchUsage,
  fmtMoney,
  fmtTokens,
  isHosted,
  lastUsedLabel,
  pieFormat,
  pieValue,
} from '../lib/manager'
import type {
  OrgCharts,
  OrgScope,
  OrgUsageRow,
  PersonDetail,
} from '../lib/manager'
import { DonutCard } from '../components/dashboard/DonutCard'
import { PricingModal } from '../components/PricingModal'
import type { DonutDatum } from '../components/dashboard/DonutCard'
import '../components/dashboard/dashboard.css'
import '../components/manager/manager.css'

type Range = '24h' | '7d' | '30d' | 'mtd'
type TimelineMetric = 'tokens' | 'cost'

const RANGES: { value: Range; label: string }[] = [
  { value: '24h', label: '24h' },
  { value: '7d', label: '7d' },
  { value: '30d', label: '30d' },
  { value: 'mtd', label: 'MTD' },
]

const COLUMNS = [
  { key: 'full_name', label: 'Person', numeric: false },
  { key: 'cost_usd', label: 'Spend', numeric: true },
  { key: 'total_tokens', label: 'Tokens', numeric: true },
  { key: 'requests', label: 'Requests', numeric: true },
  { key: 'last_used', label: 'Last used', numeric: false },
  { key: 'quota_spent_usd', label: 'Budget', numeric: true },
] as const

type SortKey = (typeof COLUMNS)[number]['key']

interface Slice<T> {
  item: T | null
  name: string
  value: number
}

function topSlices<T>(
  items: T[],
  value: (item: T) => number,
  name: (item: T) => string,
  tailLabel: (count: number) => string,
  limit = 8,
): Slice<T>[] {
  const ranked = items
    .map((item) => ({ item, name: name(item), value: value(item) }))
    .sort((a, b) => b.value - a.value)
  const top = ranked.slice(0, limit)
  const tail = ranked.slice(limit)
  const slices: Slice<T>[] = top.map((entry) => ({ item: entry.item, name: entry.name, value: entry.value }))
  if (tail.length) {
    slices.push({
      item: null,
      name: tailLabel(tail.length),
      value: tail.reduce((sum, entry) => sum + entry.value, 0),
    })
  }
  return slices
}

function percent(part: number, whole: number): number {
  return whole > 0 ? (100 * part) / whole : 0
}

function Meter({ value, label }: { value: number; label: string }) {
  const bounded = Math.max(0, Math.min(100, value))
  const tone = value > 100 ? 'over' : value >= 80 ? 'warn' : 'ok'
  return (
    <div
      className={`pf-manager-meter pf-manager-meter--${tone}`}
      role="progressbar"
      aria-label={label}
      aria-valuenow={Math.round(bounded)}
      aria-valuemin={0}
      aria-valuemax={100}
    >
      <span style={{ width: `${bounded}%` }} />
    </div>
  )
}

export function ManagerPage() {
  const { who } = useSession()
  const [scope, setScope] = useState<OrgScope | null>(null)
  const [scopeError, setScopeError] = useState(false)
  const [rows, setRows] = useState<OrgUsageRow[]>([])
  const [roster, setRoster] = useState<OrgUsageRow[]>([])
  /** Month-to-date rows for the budget card; independent of the time range. */
  const [budgetRows, setBudgetRows] = useState<OrgUsageRow[]>([])
  const [charts, setCharts] = useState<OrgCharts | null>(null)
  const [loadError, setLoadError] = useState(false)
  const [loading, setLoading] = useState(true)
  const [range, setRange] = useState<Range>('mtd')
  const [drill, setDrill] = useState('')
  const [savingsRef, setSavingsRef] = useState('claude-opus-4-8')
  const [modelMetric, setModelMetric] = useState<PieMetric>('tokens')
  const [userMetric, setUserMetric] = useState<PieMetric>('cost')
  const [timelineMetric, setTimelineMetric] = useState<TimelineMetric>('tokens')
  const [sort, setSort] = useState<{ index: number; direction: 'asc' | 'desc' }>({
    index: 1,
    direction: 'desc',
  })
  const [filterOpen, setFilterOpen] = useState(false)
  const [filterQuery, setFilterQuery] = useState('')
  const [personSlug, setPersonSlug] = useState<string | null>(null)
  const [pricingOpen, setPricingOpen] = useState(false)
  const [person, setPerson] = useState<PersonDetail | null>(null)
  const [personLoading, setPersonLoading] = useState(false)
  const [personError, setPersonError] = useState(false)
  const filterToggleRef = useRef<HTMLButtonElement>(null)
  const filterMenuRef = useRef<HTMLDivElement>(null)
  const abortRef = useRef<AbortController | null>(null)

  const isSelf = scope?.scope === 'self'

  useEffect(() => {
    const controller = new AbortController()
    fetchScope(controller.signal)
      .then((next) => setScope(next))
      .catch(() => {
        if (!controller.signal.aborted) setScopeError(true)
      })
    return () => controller.abort()
  }, [])

  useEffect(() => {
    if (!scope) return
    const controller = new AbortController()
    abortRef.current?.abort()
    abortRef.current = controller
    setLoading(true)
    setLoadError(false)

    const load = async () => {
      try {
        if (scope.scope === 'self') {
          const [usage, nextCharts] = await Promise.all([
            fetchUsage(range, '', controller.signal),
            fetchSelfCharts(range, savingsRef, controller.signal),
          ])
          if (controller.signal.aborted) return
          setRows(usage)
          setRoster(usage)
          setBudgetRows(usage)
          setCharts(nextCharts)
        } else {
          const rosterPromise = fetchUsage(range, '', controller.signal)
          const rowsPromise = drill ? fetchUsage(range, drill, controller.signal) : rosterPromise
          // The budget is calendar-month regardless of the displayed range;
          // reuse the usage response when the range already is MTD.
          const budgetPromise =
            range === 'mtd' ? rowsPromise : fetchUsage('mtd', drill, controller.signal)
          const [nextRows, nextRoster, nextBudget, nextCharts] = await Promise.all([
            rowsPromise,
            rosterPromise,
            budgetPromise,
            fetchCharts(range, drill, savingsRef, controller.signal),
          ])
          if (controller.signal.aborted) return
          setRows(nextRows)
          setRoster(nextRoster)
          setBudgetRows(nextBudget)
          setCharts(nextCharts)
        }
        setLoadError(false)
      } catch {
        if (controller.signal.aborted) return
        // Do not keep the previous range/root's numbers under a new filter.
        setRows([])
        setBudgetRows([])
        setCharts(null)
        setLoadError(true)
      } finally {
        if (!controller.signal.aborted) setLoading(false)
      }
    }

    void load()
    return () => controller.abort()
  }, [scope, range, drill, savingsRef])

  useEffect(() => {
    if (!personSlug) {
      setPerson(null)
      setPersonError(false)
      return
    }
    const controller = new AbortController()
    setPersonLoading(true)
    setPersonError(false)
    fetchPerson(personSlug, range, controller.signal)
      .then((next) => {
        if (!controller.signal.aborted) setPerson(next)
      })
      .catch(() => {
        if (!controller.signal.aborted) setPersonError(true)
      })
      .finally(() => {
        if (!controller.signal.aborted) setPersonLoading(false)
      })
    return () => controller.abort()
  }, [personSlug, range])

  const sortedRows = useMemo(() => {
    const key = COLUMNS[sort.index]?.key ?? 'cost_usd'
    const direction = sort.direction === 'asc' ? 1 : -1
    return [...rows].sort((a, b) => {
      const left = a[key as SortKey]
      const right = b[key as SortKey]
      if (typeof left === 'string' || typeof right === 'string') {
        return (
          String(left ?? '').localeCompare(String(right ?? '')) * direction
        )
      }
      return (Number(left ?? 0) - Number(right ?? 0)) * direction
    })
  }, [rows, sort])

  const selectedPerson = roster.find((row) => row.slug === drill)
  const personView = Boolean(drill && selectedPerson && !selectedPerson.is_manager)
  const budgetLabel = isSelf ? 'My budget' : scope?.scope === 'admin' ? 'Org budget' : 'Team budget'
  // Month-to-date source: budgetRows is fetched separately from the display
  // range. The live API also returns quota_spent_usd as a calendar-month
  // value, but keeping a dedicated MTD read makes the tile range-independent
  // even if a range-less endpoint ever omits zero-usage people.
  const budgetSource = budgetRows.length ? budgetRows : rows
  const budgetLimit = isSelf
    ? who?.quota?.limit_usd ?? 0
    : budgetSource.reduce((sum, row) => sum + (row.quota_usd || 0), 0)
  const budgetSpent = isSelf
    ? who?.quota?.spent_usd ?? 0
    : budgetSource.reduce((sum, row) => sum + (row.quota_spent_usd || 0), 0)
  const budgetPct = percent(budgetSpent, budgetLimit)
  const selfOverLimit = isSelf && budgetLimit > 0 && budgetSpent >= budgetLimit
  const overLimit = isSelf ? 0 : budgetSource.filter((row) => row.over_limit).length
  const activeMembers = rows.filter((row) => row.requests > 0).length
  const keyedMembers = rows.filter((row) => row.username).length

  const models = charts?.models ?? []
  const users = charts?.users ?? []

  const hostedTokens = models.reduce(
    (sum, model) => sum + (isHosted(model) && model.total_tokens > 0 ? model.total_tokens : 0),
    0,
  )
  const totalTokens = models.reduce((sum, model) => sum + model.total_tokens, 0)
  const vendorTokens = Math.max(totalTokens - hostedTokens, 0)
  const hostedData: DonutDatum[] = [
    {
      label: 'Hosted',
      legend: `Hosted — ${fmtTokens(hostedTokens)}`,
      value: hostedTokens,
      color: '#3fb950',
    },
    {
      label: 'Vendor',
      legend: `Vendor — ${fmtTokens(vendorTokens)}`,
      value: vendorTokens,
      color: '#d29922',
    },
  ]

  const modelSlices = topSlices(
    models,
    (model) => pieValue(model, modelMetric),
    (model) => model.model,
    (count) => `Other — ${count} models`,
  )
  const modelData: DonutDatum[] = modelSlices.map((slice, index) => ({
    label: slice.name,
    legend: `${slice.name.length > 26 ? `${slice.name.slice(0, 25)}…` : slice.name} — ${pieFormat(slice.value, modelMetric)}`,
    value: slice.value,
    color: slice.item
      ? isHosted(slice.item)
        ? '#3fb950'
        : COLORS[index % COLORS.length]
      : '#5b6b82',
  }))

  const userSlices = topSlices(
    users,
    (user) => pieValue(user, userMetric),
    (user) => user.display_name || user.username,
    (count) => `Other — ${count} users`,
  )
  const userData: DonutDatum[] = userSlices.map((slice, index) => ({
    label: slice.name,
    legend: `${slice.name.length > 26 ? `${slice.name.slice(0, 25)}…` : slice.name} — ${pieFormat(slice.value, userMetric)}`,
    value: slice.value,
    color: slice.item ? COLORS[index % COLORS.length] : '#5b6b82',
  }))

  const timeline = useMemo(() => {
    const points = charts?.timeline ?? []
    const byDay = new Map<string, Record<string, number>>()
    const totals = new Map<string, number>()
    for (const point of points) {
      const day = point.bucket.slice(0, 10)
      const value = timelineMetric === 'cost' ? point.total_cost_usd : point.total_tokens
      const bucket = byDay.get(day) ?? {}
      bucket[point.series] = (bucket[point.series] ?? 0) + value
      byDay.set(day, bucket)
      totals.set(point.series, (totals.get(point.series) ?? 0) + value)
    }
    const days = [...byDay.keys()].sort()
    const ranked = [...totals.entries()]
      .filter(([, value]) => value > 0)
      .sort((a, b) => b[1] - a[1])
    const top = ranked.slice(0, 7).map(([name]) => name)
    const tail = ranked.slice(7).map(([name]) => name)
    const names = top.concat(tail.length ? ['Other'] : [])
    return {
      days,
      series: names.map((name, index) => ({
        name,
        color: name === 'Other' ? '#5b6b82' : COLORS[index % COLORS.length],
        data: days.map((day) => ({
          x: day,
          y:
            name === 'Other'
              ? tail.reduce((sum, series) => sum + (byDay.get(day)?.[series] ?? 0), 0)
              : byDay.get(day)?.[name] ?? 0,
        })),
      })),
    }
  }, [charts, timelineMetric])

  const filteredPeople = useMemo(() => {
    const query = filterQuery.trim().toLowerCase()
    return [...roster]
      .sort((a, b) =>
        String(a.full_name || a.username || a.slug).localeCompare(
          String(b.full_name || b.username || b.slug),
        ),
      )
      .filter((row) => {
        if (!query) return true
        return (
          String(row.full_name || '').toLowerCase().includes(query) ||
          row.username.toLowerCase().includes(query)
        )
      })
  }, [roster, filterQuery])

  const filterLabel = selectedPerson
    ? selectedPerson.full_name || selectedPerson.username || 'Selected scope'
    : isSelf
      ? 'My usage'
      : scope?.scope === 'admin'
        ? 'Whole organisation'
        : 'Whole team'

  const showFilter = !isSelf && (roster.length > 1 || Boolean(drill))
  const title = isSelf ? 'My usage' : scope?.scope === 'admin' ? 'Org view' : 'Team view'
  const subtitle = isSelf
    ? 'You are not listed as a manager in the directory — showing your own usage.'
    : personView
      ? `Individual usage · ${keyedMembers} with a gateway key · this window`
      : `${rows.length} people ${
          drill
            ? 'in the selected team'
            : scope?.scope === 'admin'
              ? 'in the organisation'
              : 'in your tree'
        } · ${keyedMembers} with a gateway key · this window`
  const membersTitle = personView
    ? 'Person usage'
    : scope?.scope === 'admin' && !drill
      ? 'Organisation members'
      : 'Team members'

  const timelineMax = timeline.series.reduce(
    (max, series) => Math.max(max, ...series.data.map((point) => point.y)),
    0,
  )

  const personTotals = person
    ? person.models.reduce(
        (totals, model) => ({
          spend: totals.spend + model.cost_usd,
          tokens: totals.tokens + model.total_tokens,
          requests: totals.requests + model.requests,
          saved: totals.saved + model.saved_usd,
        }),
        { spend: 0, tokens: 0, requests: 0, saved: 0 },
      )
    : null

  if (scopeError) {
    return (
      <PageSection>
        <Alert variant="danger" isInline title="Could not load the organisation scope">
          The gateway did not answer the scope request.
          <Button variant="link" isInline onClick={() => window.location.reload()}>
            Retry
          </Button>
        </Alert>
      </PageSection>
    )
  }

  if (!scope) {
    return (
      <PageSection>
        <Bullseye>
          <Spinner size="xl" aria-label="Loading manager view" />
        </Bullseye>
      </PageSection>
    )
  }

  return (
    <PageSection>
      <div className="pf-manager-page">
        <header className="pf-manager-header">
          <div>
            <Title headingLevel="h1" size="2xl">
              {title}
            </Title>
            <p className="pf-manager-sub">{subtitle}</p>
          </div>
          <div className="pf-manager-controls">
            {loading && <Spinner size="md" aria-label="Loading manager data" />}
            {showFilter && (
              <Popper
                trigger={
                  <MenuToggle
                    ref={filterToggleRef}
                    onClick={() => setFilterOpen(!filterOpen)}
                    isExpanded={filterOpen}
                    className="pf-manager-filter-toggle"
                  >
                    {filterLabel}
                  </MenuToggle>
                }
                triggerRef={filterToggleRef}
                popper={
                  <Menu
                    ref={filterMenuRef}
                    aria-label="Focus on a person or team"
                    isScrollable
                    className="pf-manager-filter-menu"
                    onSelect={(_event, itemId) => {
                      setDrill(String(itemId) === '__all__' ? '' : String(itemId))
                      setPersonSlug(null)
                      setFilterOpen(false)
                    }}
                  >
                    <MenuSearch>
                      <MenuSearchInput>
                        <SearchInput
                          value={filterQuery}
                          aria-label="Search people"
                          placeholder="Search anyone by name or username..."
                          onChange={(_event, value) => setFilterQuery(value)}
                          onClear={() => setFilterQuery('')}
                        />
                      </MenuSearchInput>
                    </MenuSearch>
                    <MenuContent>
                      <MenuList>
                        <MenuItem
                          itemId="__all__"
                          isSelected={drill === ''}
                          description={
                            scope.scope === 'admin'
                              ? 'Everyone in the organisation'
                              : 'Everyone in your tree'
                          }
                        >
                          {scope.scope === 'admin' ? 'Whole organisation' : 'Whole team'}
                        </MenuItem>
                        {filteredPeople.map((row) => (
                          <MenuItem
                            key={row.slug}
                            itemId={row.slug}
                            isSelected={drill === row.slug}
                            description={row.username || 'no gateway key'}
                          >
                            {row.full_name || row.username || row.slug}
                            {row.is_manager ? ' · mgr' : ''}
                          </MenuItem>
                        ))}
                        {filteredPeople.length === 0 && (
                          <MenuItem isDisabled>No people match</MenuItem>
                        )}
                      </MenuList>
                    </MenuContent>
                  </Menu>
                }
                popperRef={filterMenuRef}
                isVisible={filterOpen}
                zIndex={9999}
                placement="bottom-end"
                enableFlip
                onDocumentClick={(event, triggerElement, popperElement) => {
                  const target = event?.target as Node | null
                  if (
                    target &&
                    (triggerElement?.contains(target) || popperElement?.contains(target))
                  ) {
                    return
                  }
                  setFilterOpen(false)
                }}
                onDocumentKeyDown={(event) => {
                  if (event?.key === 'Escape') setFilterOpen(false)
                }}
              />
            )}
            <Button variant="secondary" onClick={() => setPricingOpen(true)}>
              Pricing
            </Button>
            <ToggleGroup aria-label="Time range" isCompact>
              {RANGES.map((entry) => (
                <ToggleGroupItem
                  key={entry.value}
                  text={entry.label}
                  isSelected={range === entry.value}
                  onChange={() => setRange(entry.value)}
                />
              ))}
            </ToggleGroup>
          </div>
        </header>

        {loadError && (
          <Alert variant="warning" isInline title="Some manager data could not be loaded">
            The last successful numbers are still shown. Change the range to retry.
          </Alert>
        )}

        <div className={`pf-manager-kpis${isSelf ? ' pf-manager-kpis--self' : ''}`}>
          <Card className="pf-manager-kpi">
            <CardBody>
              <span className="pf-manager-kpi-label">{budgetLabel}</span>
              <span className="pf-manager-kpi-value">
                {budgetLimit > 0 ? fmtMoney(budgetSpent) : '–'}
              </span>
              {budgetLimit > 0 && <Meter value={budgetPct} label="Budget used" />}
              <span className="pf-manager-kpi-sub">
                {budgetLimit > 0
                  ? `of ${fmtMoney(budgetLimit)} this month${
                      budgetPct > 100
                        ? ' · over budget'
                        : budgetPct >= 80
                          ? ` · ${Math.round(budgetPct)}% used`
                          : ''
                    }`
                  : 'No limit configured'}
                {isSelf
                  ? selfOverLimit
                    ? ' · over limit'
                    : ''
                  : overLimit > 0
                    ? ` · ${overLimit} ${overLimit === 1 ? 'person' : 'people'} over limit`
                    : ''}
              </span>
            </CardBody>
          </Card>

          <Card className="pf-manager-kpi">
            <CardBody>
              <span className="pf-manager-kpi-label">Saved · Hosted Models</span>
              <span className="pf-manager-kpi-value pf-manager-kpi-value--saved">
                {charts?.overview.saved_usd == null ? '–' : fmtMoney(charts.overview.saved_usd)}
              </span>
              <div className="pf-manager-kpi-sub">
                vs{' '}
                <span className="pf-dashboard-savings-select">
                  <FormSelect
                    aria-label="Savings comparison model"
                    value={savingsRef}
                    onChange={(_event, value) => setSavingsRef(value)}
                  >
                    {SAVINGS_REF_OPTIONS.map((model) => (
                      <FormSelectOption key={model} value={model} label={model} />
                    ))}
                  </FormSelect>
                </span>
                {charts?.overview.savings_ratio_applied
                  ? `${Math.round(charts.overview.savings_ratio * 100)}% input est. cached`
                  : ''}
              </div>
            </CardBody>
          </Card>

          {!isSelf && (
            <Card className="pf-manager-kpi">
              <CardBody>
                <span className="pf-manager-kpi-label">Members</span>
                <span className="pf-manager-kpi-value">{rows.length}</span>
                <span className="pf-manager-kpi-sub">
                  {activeMembers} with usage this window
                </span>
              </CardBody>
            </Card>
          )}
        </div>

        <Grid hasGutter md={4} lg={4}>
          <GridItem>
            <DonutCard
              title="Token Usage · Hosted vs Vendor"
              ariaTitle="Token usage, hosted versus vendor"
              ariaDesc="Share of tokens served by hosted models versus vendor APIs"
              data={hostedData}
              formatValue={fmtTokens}
              unit=" tokens"
            />
          </GridItem>
          <GridItem>
            <DonutCard
              title="By Model"
              ariaTitle="Usage by model"
              ariaDesc="Token, cost, or request share by model"
              data={modelData}
              formatValue={(value) => pieFormat(value, modelMetric)}
              unit={modelMetric === 'tokens' ? ' tokens' : modelMetric === 'requests' ? ' reqs' : ''}
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
              title="By User"
              ariaTitle="Usage by user"
              ariaDesc="Cost, token, or request share by user"
              data={userData}
              formatValue={(value) => pieFormat(value, userMetric)}
              unit={userMetric === 'tokens' ? ' tokens' : userMetric === 'requests' ? ' reqs' : ''}
              footer={
                <ToggleGroup aria-label="User metric" isCompact>
                  <ToggleGroupItem
                    text="Cost"
                    isSelected={userMetric === 'cost'}
                    onChange={() => setUserMetric('cost')}
                  />
                  <ToggleGroupItem
                    text="Tokens"
                    isSelected={userMetric === 'tokens'}
                    onChange={() => setUserMetric('tokens')}
                  />
                  <ToggleGroupItem
                    text="Requests"
                    isSelected={userMetric === 'requests'}
                    onChange={() => setUserMetric('requests')}
                  />
                </ToggleGroup>
              }
            />
          </GridItem>
        </Grid>

        <Card>
          <CardTitle>
            <div className="pf-manager-controls" style={{ justifyContent: 'space-between' }}>
              <span>Daily model usage</span>
              <ToggleGroup aria-label="Timeline metric" isCompact>
                <ToggleGroupItem
                  text="Tokens"
                  isSelected={timelineMetric === 'tokens'}
                  onChange={() => setTimelineMetric('tokens')}
                />
                <ToggleGroupItem
                  text="Dollars"
                  isSelected={timelineMetric === 'cost'}
                  onChange={() => setTimelineMetric('cost')}
                />
              </ToggleGroup>
            </div>
          </CardTitle>
          <CardBody>
            <div className="pf-manager-timeline">
              {timeline.series.length === 0 || timeline.days.length === 0 ? (
                <p className="pf-manager-sub">No usage in this window.</p>
              ) : (
                <Chart
                  ariaTitle="Daily model usage"
                  ariaDesc="Tokens or dollars per day, grouped by model"
                  height={280}
                  width={900}
                  padding={{ top: 10, right: 20, bottom: 60, left: 70 }}
                  domain={{ y: [0, timelineMax > 0 ? timelineMax * 1.1 : 1] }}
                  legendData={timeline.series.map((series) => ({
                    name: series.name,
                    symbol: { fill: series.color },
                  }))}
                  legendPosition="bottom"
                  legendOrientation="horizontal"
                  containerComponent={
                    <ChartVoronoiContainer
                      constrainToVisibleArea
                      labels={(point: { datum?: { childName?: string; y?: number } }) => {
                        const name = point.datum?.childName ?? ''
                        const value = point.datum?.y ?? 0
                        return `${name}: ${
                          timelineMetric === 'cost' ? fmtMoney(value) : fmtTokens(value)
                        }`
                      }}
                    />
                  }
                >
                  <ChartAxis tickFormat={(tick) => String(tick).slice(5)} />
                  <ChartAxis
                    dependentAxis
                    showGrid
                    tickCount={5}
                    tickFormat={(tick) =>
                      timelineMetric === 'cost'
                        ? fmtMoney(Number(tick))
                        : fmtTokens(Number(tick))
                    }
                  />
                  <ChartGroup>
                    {timeline.series.map((series) => (
                      <ChartLine
                        key={series.name}
                        name={series.name}
                        data={series.data}
                        style={{ data: { stroke: series.color } }}
                      />
                    ))}
                  </ChartGroup>
                </Chart>
              )}
            </div>
          </CardBody>
        </Card>

        <Card>
          <CardTitle>
            {membersTitle}{' '}
            <span className="pf-manager-person-meta">
              — click a person for their per-model breakdown
            </span>
          </CardTitle>
          <CardBody>
            <div className="pf-manager-table-scroll">
              <Table aria-label={membersTitle} variant="compact">
                <Thead>
                  <Tr>
                    {COLUMNS.map((column, index) => (
                      <Th
                        key={column.key}
                        className={column.numeric ? 'pf-manager-num' : undefined}
                        sort={{
                          sortBy: { index: sort.index, direction: sort.direction },
                          columnIndex: index,
                          onSort: (_event, nextIndex, direction) =>
                            setSort({ index: nextIndex, direction }),
                        }}
                      >
                        {column.label}
                      </Th>
                    ))}
                  </Tr>
                </Thead>
                <Tbody>
                  {sortedRows.length === 0 && (
                    <Tr>
                      <Td colSpan={COLUMNS.length}>No usage yet — expected during week one.</Td>
                    </Tr>
                  )}
                  {sortedRows.map((row, index) => {
                    const clickable = Boolean(row.username && row.slug)
                    const rowBudget = row.quota_usd > 0 ? percent(row.quota_spent_usd, row.quota_usd) : 0
                    return (
                      <Tr
                        key={row.slug || `${row.username || 'row'}-${index}`}
                        isClickable={clickable}
                        className={clickable ? 'pf-manager-row' : undefined}
                        tabIndex={clickable ? 0 : undefined}
                        onClick={() => {
                          if (clickable) setPersonSlug(row.slug)
                        }}
                        onKeyDown={(event) => {
                          if (!clickable) return
                          if (event.key === 'Enter' || event.key === ' ') {
                            event.preventDefault()
                            setPersonSlug(row.slug)
                          }
                        }}
                      >
                        <Td>
                          <div className="pf-manager-person">
                            <span className="pf-manager-person-name">
                              {row.full_name || row.username || 'Unnamed'}
                              {row.is_manager && (
                                <>
                                  {' '}
                                  <Label isCompact color="blue">
                                    mgr
                                  </Label>
                                </>
                              )}
                            </span>
                            {row.username ? (
                              <span className="pf-manager-person-meta">{row.username}</span>
                            ) : (
                              <span>
                                <Label isCompact color="grey">
                                  no key yet
                                </Label>
                              </span>
                            )}
                          </div>
                        </Td>
                        <Td className="pf-manager-num">
                          {row.username ? fmtMoney(row.cost_usd) : '–'}
                        </Td>
                        <Td className="pf-manager-num">
                          {row.username ? fmtTokens(row.total_tokens) : ''}
                        </Td>
                        <Td className="pf-manager-num">{row.requests || ''}</Td>
                        <Td className="pf-manager-person-meta">{lastUsedLabel(row.last_used)}</Td>
                        <Td className="pf-manager-num">
                          {row.quota_usd > 0 ? (
                            <div>
                              <Meter
                                value={rowBudget}
                                label={`Budget used by ${row.full_name || row.username}`}
                              />
                              <span className="pf-manager-person-meta">
                                {fmtMoney(row.quota_spent_usd)} / {fmtMoney(row.quota_usd)}
                              </span>
                            </div>
                          ) : (
                            <span className="pf-manager-person-meta">–</span>
                          )}
                        </Td>
                      </Tr>
                    )
                  })}
                </Tbody>
              </Table>
            </div>
          </CardBody>
        </Card>
      </div>

      <Modal
        isOpen={personSlug !== null}
        onClose={() => setPersonSlug(null)}
        variant="medium"
        aria-labelledby="pf-manager-person-title"
      >
        <ModalHeader
          title={person?.full_name || 'Person usage'}
          labelId="pf-manager-person-title"
        />
        <ModalBody>
          {personLoading && (
            <Bullseye>
              <Spinner size="lg" aria-label="Loading person usage" />
            </Bullseye>
          )}
          {personError && !personLoading && (
            <Alert variant="danger" isInline title="Could not load this person's usage" />
          )}
          {person && !personLoading && personTotals && (
            <>
              <div className="pf-manager-modal-kpis">
                <div className="pf-manager-modal-kpi">
                  <span className="pf-manager-modal-kpi-label">Spend</span>
                  <span className="pf-manager-modal-kpi-value">
                    {fmtMoney(personTotals.spend)}
                  </span>
                </div>
                <div className="pf-manager-modal-kpi">
                  <span className="pf-manager-modal-kpi-label">Tokens</span>
                  <span className="pf-manager-modal-kpi-value">
                    {fmtTokens(personTotals.tokens)}
                  </span>
                </div>
                <div className="pf-manager-modal-kpi">
                  <span className="pf-manager-modal-kpi-label">Requests</span>
                  <span className="pf-manager-modal-kpi-value">{personTotals.requests}</span>
                </div>
                <div className="pf-manager-modal-kpi">
                  <span className="pf-manager-modal-kpi-label">Saved · hosted</span>
                  <span className="pf-manager-modal-kpi-value">
                    {fmtMoney(personTotals.saved)}
                  </span>
                </div>
                <div className="pf-manager-modal-kpi">
                  <span className="pf-manager-modal-kpi-label">Models</span>
                  <span className="pf-manager-modal-kpi-value">{person.models.length}</span>
                </div>
              </div>
              <p className="pf-manager-person-meta">
                {person.usernames.length
                  ? person.usernames.join(', ')
                  : 'No gateway key in the directory'}
              </p>
              <div className="pf-manager-table-scroll">
                <Table aria-label="Per-model usage" variant="compact">
                  <Thead>
                    <Tr>
                      <Th>Model</Th>
                      <Th className="pf-manager-num">Requests</Th>
                      <Th className="pf-manager-num">Tokens</Th>
                      <Th className="pf-manager-num">Cost</Th>
                      <Th className="pf-manager-num">Saved</Th>
                      <Th>Last used</Th>
                    </Tr>
                  </Thead>
                  <Tbody>
                    {person.models.length === 0 && (
                      <Tr>
                        <Td colSpan={6}>No usage in this window.</Td>
                      </Tr>
                    )}
                    {person.models.map((model) => (
                      <Tr key={model.model}>
                        <Td>{model.model}</Td>
                        <Td className="pf-manager-num">{model.requests}</Td>
                        <Td className="pf-manager-num">{fmtTokens(model.total_tokens)}</Td>
                        <Td className="pf-manager-num">{fmtMoney(model.cost_usd)}</Td>
                        <Td className="pf-manager-num">{fmtMoney(model.saved_usd)}</Td>
                        <Td className="pf-manager-person-meta">
                          {lastUsedLabel(model.last_used)}
                        </Td>
                      </Tr>
                    ))}
                  </Tbody>
                </Table>
              </div>
            </>
          )}
        </ModalBody>
        <ModalFooter>
          <Button variant="link" onClick={() => setPersonSlug(null)}>
            Close
          </Button>
        </ModalFooter>
      </Modal>
      <PricingModal isOpen={pricingOpen} onClose={() => setPricingOpen(false)} />
    </PageSection>
  )
}

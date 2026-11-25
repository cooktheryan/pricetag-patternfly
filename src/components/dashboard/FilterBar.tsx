import { useEffect, useRef, useState } from 'react'
import {
  Button,
  Card,
  CardBody,
  FormSelect,
  FormSelectOption,
  Menu,
  MenuContent,
  MenuFooter,
  MenuItem,
  MenuList,
  MenuSearch,
  MenuSearchInput,
  MenuToggle,
  Popper,
  SearchInput,
  TextInput,
  ToggleGroup,
  ToggleGroupItem,
  Toolbar,
  ToolbarContent,
  ToolbarItem,
} from '@patternfly/react-core'
import type { DashboardFilters, ModelRow, RangePreset, UserRow } from '../../lib/dashboard'
import { dstr, rangeBounds } from '../../lib/dashboard'

const INITIAL_TODAY = dstr(new Date())

const RANGES: { value: Exclude<RangePreset, 'custom'>; label: string; title: string }[] = [
  { value: '24h', label: '24h', title: 'Last 24 hours' },
  { value: '7d', label: '7d', title: 'Last 7 days' },
  { value: '30d', label: '30d', title: 'Last 30 days' },
  { value: 'mtd', label: 'MTD', title: 'Month to date' },
]

interface FilterBarProps {
  filters: DashboardFilters
  isAdmin: boolean
  /** Range-only model catalog, so filtering never shrinks the picker. */
  models: ModelRow[]
  /** Merged usage + directory roster for the user filter. */
  users: UserRow[]
  onChange: (next: DashboardFilters) => void
  onClear: () => void
}

export function FilterBar({ filters, isAdmin, models, users, onChange, onClear }: FilterBarProps) {
  // Date-input upper bound. A dashboard left open across midnight still
  // accepts the new day instead of pinning max to the previous load date.
  const [today, setToday] = useState(INITIAL_TODAY)
  useEffect(() => {
    const id = setInterval(() => setToday(dstr(new Date())), 60_000)
    return () => clearInterval(id)
  }, [])

  const [userMenuOpen, setUserMenuOpen] = useState(false)
  const [userQuery, setUserQuery] = useState('')
  const toggleRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)

  const setPreset = (range: Exclude<RangePreset, 'custom'>) => {
    const bounds = rangeBounds(range)
    onChange({ ...filters, range, customFrom: bounds.from, customTo: bounds.to })
  }

  // Legacy setCustomRange: the preset stays active until both ends are set.
  const setFrom = (value: string) => {
    const next = { ...filters, customFrom: value }
    onChange(value && filters.customTo ? { ...next, range: 'custom' } : next)
  }
  const setTo = (value: string) => {
    const next = { ...filters, customTo: value }
    onChange(filters.customFrom && value ? { ...next, range: 'custom' } : next)
  }

  const displayNames = new Map(users.map((u) => [u.username, u.display_name]))
  const roster = Array.from(
    new Set([...users.map((u) => u.username).filter(Boolean), ...filters.userFilter]),
  ).sort((a, b) => a.localeCompare(b))
  const query = userQuery.trim().toLowerCase()
  const matches = (username: string) =>
    !query ||
    username.toLowerCase().includes(query) ||
    (displayNames.get(username) || '').toLowerCase().includes(query)
  const shown = roster.filter(matches)

  const toggleUser = (username: string) => {
    const next = filters.userFilter.includes(username)
      ? filters.userFilter.filter((u) => u !== username)
      : [...filters.userFilter, username]
    onChange({ ...filters, userFilter: next })
  }

  const userLabel =
    filters.userFilter.length === 0
      ? 'All'
      : filters.userFilter.length === 1
        ? filters.userFilter[0]
        : `${filters.userFilter.length} selected`

  const userFilter = (
    <Popper
      trigger={
        <MenuToggle
          ref={toggleRef}
          onClick={() => setUserMenuOpen(!userMenuOpen)}
          isExpanded={userMenuOpen}
          className="pf-dashboard-user-toggle"
        >
          {userLabel}
        </MenuToggle>
      }
      triggerRef={toggleRef}
      popper={
        <Menu
          ref={menuRef}
          aria-label="Filter by user"
          isScrollable
          className="pf-dashboard-user-menu"
          selected={filters.userFilter}
          onSelect={(_event, itemId) => toggleUser(String(itemId))}
        >
          <MenuSearch>
            <MenuSearchInput>
              <SearchInput
                value={userQuery}
                aria-label="Filter users"
                placeholder="Filter users..."
                onChange={(_event, value) => setUserQuery(value)}
                onClear={() => setUserQuery('')}
              />
            </MenuSearchInput>
          </MenuSearch>
          <MenuContent>
            <MenuList>
              {shown.length === 0 && <MenuItem isDisabled>No users</MenuItem>}
              {shown.map((username) => (
                <MenuItem
                  key={username}
                  itemId={username}
                  hasCheckbox
                  isSelected={filters.userFilter.includes(username)}
                  description={displayNames.get(username) ? username : undefined}
                >
                  {displayNames.get(username) || username}
                </MenuItem>
              ))}
            </MenuList>
          </MenuContent>
          <MenuFooter>
            {/* Deployed behaviour: Select all replaces the selection with the
                users matching the current search (selectAllUsers(true)). */}
            <Button variant="link" isInline onClick={() => onChange({ ...filters, userFilter: shown })}>
              Select all
            </Button>
            <Button variant="link" isInline onClick={() => onChange({ ...filters, userFilter: [] })}>
              Clear
            </Button>
          </MenuFooter>
        </Menu>
      }
      popperRef={menuRef}
      isVisible={userMenuOpen}
      zIndex={9999}
      placement="bottom-start"
      enableFlip
      onDocumentClick={(event, triggerElement, popperElement) => {
        const target = event?.target as Node | null
        if (target && (triggerElement?.contains(target) || popperElement?.contains(target))) return
        setUserMenuOpen(false)
      }}
      onDocumentKeyDown={(event) => {
        if (event?.key === 'Escape') setUserMenuOpen(false)
      }}
    />
  )

  return (
    <Card className="pf-dashboard-filters">
      <CardBody>
        <Toolbar>
          <ToolbarContent>
            <ToolbarItem>
              <span className="pf-dashboard-filters-label">Filters</span>
            </ToolbarItem>

            {/* Each label and its control live in one ToolbarItem so a
                wrapped toolbar never leaves a label stranded on its own. */}
            <ToolbarItem>
              <div className="pf-dashboard-filter-group">
                <span className="pf-dashboard-field-label">Time:</span>
                <ToggleGroup aria-label="Time range" isCompact>
                  {RANGES.map((range) => (
                    <ToggleGroupItem
                      key={range.value}
                      text={range.label}
                      title={range.title}
                      isSelected={filters.range === range.value}
                      onChange={() => setPreset(range.value)}
                    />
                  ))}
                </ToggleGroup>
              </div>
            </ToolbarItem>

            <ToolbarItem>
              <div className="pf-dashboard-filter-group">
                <TextInput
                  type="date"
                  aria-label="From date"
                  className="pf-dashboard-date"
                  value={filters.customFrom}
                  max={today}
                  onChange={(_event, value) => setFrom(value)}
                />
                <span className="pf-dashboard-field-label">to</span>
                <TextInput
                  type="date"
                  aria-label="To date"
                  className="pf-dashboard-date"
                  value={filters.customTo}
                  max={today}
                  onChange={(_event, value) => setTo(value)}
                />
              </div>
            </ToolbarItem>

            <ToolbarItem>
              <div className="pf-dashboard-filter-group">
                <span className="pf-dashboard-field-label">Model:</span>
                <FormSelect
                  aria-label="Filter by model"
                  className="pf-dashboard-model-select"
                  value={filters.modelFilter}
                  onChange={(_event, value) => onChange({ ...filters, modelFilter: value })}
                >
                  <FormSelectOption value="" label="All" />
                  {models.map((model) => (
                    <FormSelectOption key={model.model} value={model.model} label={model.model} />
                  ))}
                </FormSelect>
              </div>
            </ToolbarItem>

            {isAdmin && (
              <ToolbarItem>
                <div className="pf-dashboard-filter-group">
                  <span className="pf-dashboard-field-label">User:</span>
                  {userFilter}
                </div>
              </ToolbarItem>
            )}

            <ToolbarItem>
              <Button variant="secondary" onClick={onClear}>
                Clear All
              </Button>
            </ToolbarItem>
          </ToolbarContent>
        </Toolbar>
      </CardBody>
    </Card>
  )
}

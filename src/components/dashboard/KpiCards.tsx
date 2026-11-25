import type { ReactNode } from 'react'
import { Card, CardBody, FormSelect, FormSelectOption } from '@patternfly/react-core'
import type { Overview } from '../../lib/dashboard'
import { fmtC, fmtN, SAVINGS_REF_OPTIONS } from '../../lib/dashboard'

type KpiTone = 'blue' | 'green' | 'orange' | 'purple' | 'saved'

function Kpi({
  label,
  value,
  tone,
  children,
}: {
  label: string
  value: string
  tone: KpiTone
  children?: ReactNode
}) {
  return (
    <Card isFullHeight className={`pf-dashboard-kpi pf-dashboard-kpi--${tone}`}>
      <CardBody>
        <span className="pf-dashboard-kpi-label">{label}</span>
        <span className="pf-dashboard-kpi-value">{value}</span>
        {children}
      </CardBody>
    </Card>
  )
}

interface KpiCardsProps {
  overview: Overview | null
  savingsRef: string
  onSavingsRefChange: (value: string) => void
}

/**
 * The five KPI cards. "Saved · Hosted Models" is the server's number
 * (overview.saved_usd) — the exact sum of the user table's saved_usd
 * column — so it can never drift from a client-side re-derivation.
 */
export function KpiCards({ overview, savingsRef, onSavingsRefChange }: KpiCardsProps) {
  const saved =
    overview === null ? '--' : overview.saved_usd === null ? '--' : fmtC(overview.saved_usd)
  const note =
    overview?.savings_ratio_applied && overview.savings_ratio
      ? `${Math.round(overview.savings_ratio * 100)}% input est. cached`
      : ''

  return (
    <div className="pf-dashboard-kpis">
      <Kpi label="Total Requests" tone="blue" value={overview ? fmtN(overview.total_requests) : '--'} />
      <Kpi label="Total Tokens" tone="green" value={overview ? fmtN(overview.total_tokens) : '--'} />
      <Kpi label="Estimated Cost" tone="orange" value={overview ? fmtC(overview.total_cost_usd) : '--'} />
      <Kpi label="Saved · Hosted Models" tone="saved" value={saved}>
        <div className="pf-dashboard-kpi-sub">
          vs{' '}
          <span className="pf-dashboard-savings-select">
            <FormSelect
              aria-label="Savings comparison model"
              value={savingsRef}
              onChange={(_event, value) => onSavingsRefChange(value)}
            >
              {SAVINGS_REF_OPTIONS.map((model) => (
                <FormSelectOption key={model} value={model} label={model} />
              ))}
            </FormSelect>
          </span>
          {note && <span className="pf-dashboard-kpi-note">{note}</span>}
        </div>
      </Kpi>
      <Kpi
        label="Active Users"
        tone="purple"
        value={overview ? String(overview.active_users) : '--'}
      />
    </div>
  )
}

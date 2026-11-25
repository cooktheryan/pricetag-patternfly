import { Card, CardBody, Title } from '@patternfly/react-core'
import type { Quota } from '../../lib/session'
import { qfmt } from '../../lib/dashboard'

/**
 * Monthly budget summary from /whoami's quota object. Mirrors the live
 * page: exempt operators get an explicit message instead of a spend bar,
 * and enforcement-disabled is called out rather than looking like a hard
 * cap.
 */
export function BudgetBanner({ quota }: { quota: Quota }) {
  const message = quota.exempt
    ? 'Administrator — exempt from the USD budget gate'
    : `${qfmt(quota.spent_usd)} spent of ${qfmt(quota.limit_usd)} this month${
        quota.enforced ? '' : ' · enforcement disabled'
      }`

  return (
    <Card className="pf-dashboard-budget">
      <CardBody>
        <Title headingLevel="h2" size="md">
          Monthly budget
        </Title>
        <p className="pf-dashboard-budget-value">{message}</p>
      </CardBody>
    </Card>
  )
}

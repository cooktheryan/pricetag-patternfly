import type { ReactNode } from 'react'
import { Card, CardBody, CardTitle } from '@patternfly/react-core'
import { ChartDonut } from '@patternfly/react-charts/victory'

export interface DonutDatum {
  label: string
  legend: string
  value: number
  color: string
}

interface DonutCardProps {
  title: ReactNode
  ariaTitle: string
  ariaDesc: string
  data: DonutDatum[]
  /** Formats a slice value for the hover tooltip. */
  formatValue: (value: number) => string
  /** Optional suffix for the tooltip value ("tokens", "requests"). */
  unit?: string
  /** Share is meaningless for distinct-user counts, so the tool suppresses it. */
  showPercent?: boolean
  /** Metric toggle rendered under the legend. */
  footer?: ReactNode
  emptyLabel?: string
}

/**
 * A donut plus the page's own legend. The legend lives outside the SVG
 * because every chart needs the same swatch-plus-label list, and keeping it
 * out of the chart lets the four cards share one layout regardless of the
 * number of slices.
 */
export function DonutCard({
  title,
  ariaTitle,
  ariaDesc,
  data,
  formatValue,
  unit = '',
  showPercent = true,
  footer,
  emptyLabel = 'No usage in this window',
}: DonutCardProps) {
  const total = data.reduce((sum, datum) => sum + datum.value, 0)

  return (
    <Card isFullHeight className="pf-dashboard-chart-card">
      <CardTitle>{title}</CardTitle>
      <CardBody>
        <div className="pf-dashboard-chart">
          {total > 0 ? (
            <div className="pf-dashboard-donut">
              <ChartDonut
                ariaTitle={ariaTitle}
                ariaDesc={ariaDesc}
                data={data.map((datum) => ({ x: datum.label, y: datum.value }))}
                colorScale={data.map((datum) => datum.color)}
                innerRadius={55}
                padAngle={0}
                constrainToVisibleArea
                width={220}
                height={220}
                labels={(point: { datum: { x: string; y: number } }) => {
                  const percent =
                    showPercent && total > 0 ? ` (${((point.datum.y / total) * 100).toFixed(1)}%)` : ''
                  return `${point.datum.x}: ${formatValue(point.datum.y)}${unit}${percent}`
                }}
              />
            </div>
          ) : data.length > 0 ? (
            // All-zero categories are meaningful (a user who used only free
            // models shows "Free"), so keep the legend and leave the plot
            // area blank — the deployed page draws nothing for zero slices.
            <div className="pf-dashboard-chart-empty" aria-hidden="true" />
          ) : (
            <div className="pf-dashboard-chart-empty">{emptyLabel}</div>
          )}

          {data.length > 0 && (
            <ul className="pf-dashboard-legend">
              {data.map((datum, index) => (
                <li key={`${datum.label}-${index}`}>
                  <span
                    className="pf-dashboard-legend-swatch"
                    style={{ backgroundColor: datum.color }}
                    aria-hidden="true"
                  />
                  <span className="pf-dashboard-legend-label" title={datum.legend}>
                    {datum.legend}
                  </span>
                </li>
              ))}
            </ul>
          )}

          {footer && <div className="pf-dashboard-chart-footer">{footer}</div>}
        </div>
      </CardBody>
    </Card>
  )
}

import { useEffect, useState } from 'react'
import {
  Alert,
  Bullseye,
  Checkbox,
  Modal,
  ModalBody,
  ModalHeader,
  Spinner,
} from '@patternfly/react-core'
import { Table, Tbody, Td, Th, Thead, Tr } from '@patternfly/react-table'
import { gatewayUrl } from '../lib/gateway'
import './pricing.css'

interface PriceRow {
  model: string
  provider: string
  hosted: boolean
  input: number
  output: number
  cacheRead: number
  cacheWrite: number
}

const rate = (value: number) =>
  `$${Number(value || 0).toLocaleString(undefined, { maximumFractionDigits: 4 })}`

function parsePrices(value: unknown): PriceRow[] {
  const record = typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {}
  const data = Array.isArray(value)
    ? value
    : Array.isArray(record.models)
      ? record.models
      : []
  return data.map((entry) => {
    const d = (entry ?? {}) as Record<string, unknown>
    return {
      model: typeof d.model === 'string' ? d.model : '',
      provider: typeof d.provider === 'string' ? d.provider : '',
      hosted: d.hosted === true,
      input: typeof d.input_cost_per_mtok === 'number' ? d.input_cost_per_mtok : 0,
      output: typeof d.output_cost_per_mtok === 'number' ? d.output_cost_per_mtok : 0,
      cacheRead: typeof d.cache_read_cost_per_mtok === 'number' ? d.cache_read_cost_per_mtok : 0,
      cacheWrite:
        typeof d.cache_write_cost_per_mtok === 'number' ? d.cache_write_cost_per_mtok : 0,
    }
  }).filter((row) => row.model !== '')
}

/**
 * Rate-card dialog behind the masthead's Pricing control. The gateway serves
 * /api/v1/pricing to any signed-in user; ?used=0 includes models with no usage.
 */
export function PricingModal({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) {
  const [showAll, setShowAll] = useState(false)
  const [rows, setRows] = useState<PriceRow[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!isOpen) return
    const controller = new AbortController()
    setLoading(true)
    setError('')
    fetch(gatewayUrl(`api/v1/pricing${showAll ? '?used=0' : ''}`), {
      cache: 'no-store',
      credentials: 'same-origin',
      signal: controller.signal,
    })
      .then(async (response) => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`)
        setRows(parsePrices(await response.json()))
      })
      .catch((reason: unknown) => {
        if (!controller.signal.aborted) {
          setError(reason instanceof Error ? reason.message : 'Could not load model pricing.')
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false)
      })
    return () => controller.abort()
  }, [isOpen, showAll])

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      variant="large"
      aria-labelledby="pf-pricing-title"
      aria-describedby="pf-pricing-description"
    >
      <ModalHeader title="Model pricing" labelId="pf-pricing-title" />
      <ModalBody>
        <p id="pf-pricing-description">
          Rates are USD per million tokens. Vendor list prices are shown as billed; hosted models
          are served by this deployment.
        </p>
        <Checkbox
          id="pf-pricing-all"
          label="Show price list for unused models too"
          isChecked={showAll}
          onChange={(_event, checked) => setShowAll(checked)}
        />
        {error && (
          <Alert variant="danger" isInline title="Could not load pricing">
            <p>{error}</p>
          </Alert>
        )}
        {loading ? (
          <Bullseye>
            <Spinner size="lg" aria-label="Loading pricing" />
          </Bullseye>
        ) : (
          <div className="pf-pricing-table">
            <Table aria-label="Model pricing" variant="compact">
              <Thead>
                <Tr>
                  <Th>Model</Th>
                  <Th>Provider</Th>
                  <Th>Hosted</Th>
                  <Th className="pf-pricing-num">Input</Th>
                  <Th className="pf-pricing-num">Output</Th>
                  <Th className="pf-pricing-num">Cache read</Th>
                  <Th className="pf-pricing-num">Cache write</Th>
                </Tr>
              </Thead>
              <Tbody>
                {rows.length === 0 && (
                  <Tr>
                    <Td colSpan={7}>No model rates reported.</Td>
                  </Tr>
                )}
                {rows.map((row) => (
                  <Tr key={`${row.provider}/${row.model}`}>
                    <Td>{row.model}</Td>
                    <Td>{row.provider || '—'}</Td>
                    <Td>{row.hosted ? 'yes' : 'no'}</Td>
                    <Td className="pf-pricing-num">{rate(row.input)}</Td>
                    <Td className="pf-pricing-num">{rate(row.output)}</Td>
                    <Td className="pf-pricing-num">{rate(row.cacheRead)}</Td>
                    <Td className="pf-pricing-num">{rate(row.cacheWrite)}</Td>
                  </Tr>
                ))}
              </Tbody>
            </Table>
          </div>
        )}
      </ModalBody>
    </Modal>
  )
}

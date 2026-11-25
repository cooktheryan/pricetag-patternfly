import { Table, Tbody, Td, Th, Thead, Tr } from '@patternfly/react-table'
import type { RecentRow } from '../../lib/dashboard'
import {
  countryFlag,
  fmtC,
  fmtN,
  friendlyClient,
  statusCell,
  timeAgo,
  toolColor,
} from '../../lib/dashboard'

function providerClass(provider: string): string {
  if (provider === 'anthropic') return 'pf-dashboard-provider pf-dashboard-provider--anthropic'
  if (provider === 'openai') return 'pf-dashboard-provider pf-dashboard-provider--openai'
  return 'pf-dashboard-provider pf-dashboard-provider--other'
}

function UserCell({ row }: { row: RecentRow }) {
  const flag = countryFlag(row.country)
  return (
    <div className="pf-dashboard-user">
      {flag && (
        <span title={`Country: ${row.country.toUpperCase()}`} aria-label={`Country: ${row.country.toUpperCase()}`}>
          {flag}
        </span>
      )}
      <div>
        {row.display_name ? (
          <>
            <div>{row.display_name}</div>
            <div className="pf-dashboard-muted">{row.username}</div>
          </>
        ) : (
          <span>{row.username}</span>
        )}
      </div>
    </div>
  )
}

/**
 * Recent Activity (live). Twelve columns, matching the deployed UI: there
 * is no cost-center column and rows are informational (the impersonation
 * confirmation is the page's only "session" dialog).
 */
export function RecentActivityTable({ rows }: { rows: RecentRow[] }) {
  // The API has no per-event id. Use the immutable event fields as the key
  // (not the array index, which would re-associate rows when new events
  // arrive) and suffix only genuine duplicates.
  const seen = new Map<string, number>()
  const keys = rows.map((row) => {
    const base = [
      row.timestamp,
      row.username,
      row.model,
      row.provider,
      row.user_agent,
      row.total_tokens,
      row.cost_usd,
    ].join('|')
    const duplicate = seen.get(base) ?? 0
    seen.set(base, duplicate + 1)
    return duplicate === 0 ? base : `${base}#${duplicate}`
  })

  return (
    <div className="pf-dashboard-table-scroll">
      <Table aria-label="Recent activity" variant="compact">
        <Thead>
          <Tr>
            <Th>Time</Th>
            <Th>User</Th>
            <Th>Client</Th>
            <Th>Model</Th>
            <Th>Provider</Th>
            <Th>Status</Th>
            <Th className="pf-dashboard-num">Input</Th>
            <Th className="pf-dashboard-num">Output</Th>
            <Th className="pf-dashboard-num">Cached</Th>
            <Th className="pf-dashboard-num">Cache Write</Th>
            <Th className="pf-dashboard-num">Total</Th>
            <Th className="pf-dashboard-num">Cost</Th>
          </Tr>
        </Thead>
        <Tbody>
          {rows.length === 0 && (
            <Tr>
              <Td colSpan={12}>No activity in this window.</Td>
            </Tr>
          )}
          {rows.map((row, index) => {
            const client = friendlyClient(row.user_agent)
            const clientLabel = client === 'Other' && row.user_agent ? row.user_agent : client
            const status = statusCell(row.status_code)
            return (
              <Tr key={keys[index]}>
                <Td className="pf-dashboard-nowrap pf-dashboard-muted">{timeAgo(row.timestamp)}</Td>
                <Td>
                  <UserCell row={row} />
                </Td>
                <Td>
                  <span
                    style={{ color: toolColor(client) }}
                    title={row.user_agent || clientLabel}
                  >
                    {clientLabel || '—'}
                  </span>
                </Td>
                <Td>{row.model || '—'}</Td>
                <Td>
                  <span className={providerClass(row.provider)}>{row.provider || '—'}</span>
                </Td>
                <Td>
                  <span
                    className={`pf-dashboard-status pf-dashboard-status--${status.tone}`}
                    title={status.title}
                  >
                    {status.text}
                  </span>
                </Td>
                <Td className="pf-dashboard-num">{fmtN(row.prompt_tokens)}</Td>
                <Td className="pf-dashboard-num">{fmtN(row.completion_tokens)}</Td>
                <Td className="pf-dashboard-num pf-dashboard-cached">{fmtN(row.cached_input_tokens)}</Td>
                <Td className="pf-dashboard-num pf-dashboard-cache-write">
                  {fmtN(row.cache_creation_tokens)}
                </Td>
                <Td className="pf-dashboard-num">{fmtN(row.total_tokens)}</Td>
                <Td className="pf-dashboard-num">{fmtC(row.cost_usd)}</Td>
              </Tr>
            )
          })}
        </Tbody>
      </Table>
    </div>
  )
}

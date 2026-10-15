import { createFileRoute } from '@tanstack/react-router'
import { useEffect, useMemo, useState } from 'react'
import { PageHeading } from '#/components/app-shell'
import {
  SortHeader,
  TableEmpty,
  TablePagination,
  TableToolbar,
} from '#/components/table-controls'
import { useTableView } from '#/lib/hooks/use-table-view'
import { calculatePayouts } from '#/lib/payouts/payouts'
import type {
  PayoutPlayer,
  PayoutPlayersResponse,
  PayoutWar,
  PayoutWarsResponse,
} from '#/models/payouts'

export const Route = createFileRoute('/payouts')({ component: Payouts })

function Payouts() {
  const [players, setPlayers] = useState<PayoutPlayer[]>([])
  const [wars, setWars] = useState<PayoutWar[]>([])
  const [warId, setWarId] = useState('')
  const [includeNonWar, setIncludeNonWar] = useState(true)
  const [earnings, setEarnings] = useState(0)
  const [rate, setRate] = useState(0)
  const [outsideRate, setOutsideRate] = useState(0)
  const [paid, setPaid] = useState<string[]>([])
  const [error, setError] = useState('')
  useEffect(() => {
    const key = localStorage.getItem('tornintel.apiKey') ?? ''
    setPaid(readPaidPayouts())
    const controller = new AbortController()
    async function loadWars() {
      try {
        const data = await fetchPayoutData<PayoutWarsResponse>(
          '/api/payout-hits',
          key,
          controller.signal,
        )
        if (controller.signal.aborted) return
        setWars(data.wars)
        setWarId((current) => current || String(data.wars[0]?.id ?? ''))
      } catch (requestError) {
        if (!controller.signal.aborted) setError(errorMessage(requestError))
      }
    }
    void loadWars()
    return () => controller.abort()
  }, [])
  useEffect(() => {
    setPlayers([])
    if (!/^\d+$/.test(warId.trim())) return
    const key = localStorage.getItem('tornintel.apiKey') ?? ''
    const controller = new AbortController()
    async function loadPlayers() {
      try {
        const data = await fetchPayoutData<PayoutPlayersResponse>(
          `/api/payout-hits?warId=${encodeURIComponent(warId.trim())}`,
          key,
          controller.signal,
        )
        if (controller.signal.aborted) return
        setError('')
        setPlayers(data.players)
      } catch (requestError) {
        if (!controller.signal.aborted) setError(errorMessage(requestError))
      }
    }
    const timer = window.setTimeout(() => void loadPlayers(), 400)
    return () => {
      window.clearTimeout(timer)
      controller.abort()
    }
  }, [warId])
  const calculation = useMemo(
    () => calculatePayouts(players, earnings, rate, outsideRate, includeNonWar),
    [players, earnings, rate, outsideRate, includeNonWar],
  )
  const payouts = calculation.payouts
  const payoutView = useTableView(payouts, {
    search: (player) => [player.name, player.id],
    filters: [
      { id: 'all', label: 'All players' },
      {
        id: 'unpaid',
        label: 'Unpaid',
        test: (player) => !paid.includes(player.id) && player.amount > 0,
      },
      { id: 'paid', label: 'Paid', test: (player) => paid.includes(player.id) },
    ],
    sorts: {
      player: (player) => player.name,
      warHits: (player) => player.warHits,
      nonWarHits: (player) => player.nonWarHits,
      payout: (player) => player.amount,
    },
  })
  function markPaid(player: (typeof payouts)[number]) {
    void navigator.clipboard.writeText(String(Math.floor(player.amount)))
    window.open(
      'https://www.torn.com/factions.php?step=your',
      '_blank',
      'noopener,noreferrer',
    )
    const next = [...new Set([...paid, player.id])]
    setPaid(next)
    localStorage.setItem('tornintel.paidPayouts', JSON.stringify(next))
  }
  return (
    <section className="payout-page">
      <PageHeading eyebrow="RANKED WAR" title="War payout">
        Select a ranked war. Outside chain hits are successful attacks during
        that war against targets outside the opposing faction that contribute to
        your faction chain.
      </PageHeading>
      <div className="payout-inputs">
        <label>
          Ranked war
          <select value={warId} onChange={(e) => setWarId(e.target.value)}>
            {wars.map((war) => (
              <option key={war.id} value={war.id}>
                #{war.id} — {new Date(war.end * 1000).toLocaleDateString()}
              </option>
            ))}
          </select>
        </label>
        <label>
          War ID
          <input
            inputMode="numeric"
            value={warId}
            onChange={(e) => setWarId(e.target.value)}
          />
        </label>
        <label>
          War earnings
          <input
            type="number"
            min="0"
            value={earnings || ''}
            onChange={(e) => setEarnings(Number(e.target.value))}
          />
        </label>
        <label>
          Pay per war hit ($)
          <input
            type="number"
            min="0"
            value={rate || ''}
            onChange={(e) => setRate(Number(e.target.value))}
          />
        </label>
        <label>
          Pay per outside chain hit ($)
          <input
            type="number"
            min="0"
            disabled={!includeNonWar}
            value={outsideRate || ''}
            onChange={(event) => setOutsideRate(Number(event.target.value))}
          />
        </label>
      </div>
      <label className="payout-include-outside">
        <input
          type="checkbox"
          checked={includeNonWar}
          onChange={(e) => setIncludeNonWar(e.target.checked)}
        />{' '}
        Include outside chain-support hits
      </label>
      <p className="payout-note">
        Outside hits use their own fixed rate per hit. Their payments are
        reserved first, then war-hit payouts use the remaining earnings. Rates
        are reduced if needed to stay within earnings; player payouts round down
        to whole dollars. Unchecking outside hits excludes them from payouts and
        the included hit count.
      </p>
      {calculation.capped && (
        <p className="payout-warning" role="status">
          Payouts were capped to your earnings. Applied rates:{' '}
          {money(calculation.appliedWarRate)} per war hit and{' '}
          {money(calculation.appliedOutsideRate)} per outside chain hit.
        </p>
      )}
      <div className="payout-summary">
        <span>
          Included hits <b>{calculation.warHits + calculation.outsideHits}</b>
        </span>
        <span>
          Outside hits included <b>{calculation.outsideHits}</b>
        </span>
        <span>
          Planned payout <b>{money(calculation.total)}</b>
        </span>
        <span>
          Left over <b>{money(calculation.remainder)}</b>
        </span>
      </div>
      {error ? (
        <p className="settings-error">{error}</p>
      ) : (
        <section className="panel table-panel">
          <TableToolbar view={payoutView} />
          <div className="table-wrap">
            <table className="payout-table">
              <thead>
                <tr>
                  <SortHeader view={payoutView} column="player">
                    PLAYER
                  </SortHeader>
                  <SortHeader view={payoutView} column="warHits">
                    WAR HITS
                  </SortHeader>
                  <SortHeader view={payoutView} column="nonWarHits">
                    OUTSIDE CHAIN HITS
                  </SortHeader>
                  <SortHeader view={payoutView} column="payout">
                    PAYOUT
                  </SortHeader>
                  <th />
                </tr>
              </thead>
              <tbody>
                {payoutView.pageItems.map((player) => (
                  <tr key={player.id}>
                    <td>{player.name}</td>
                    <td>{player.warHits}</td>
                    <td>{player.nonWarHits}</td>
                    <td>{money(player.amount)}</td>
                    <td>
                      <button
                        disabled={
                          paid.includes(player.id) || player.amount <= 0
                        }
                        onClick={() => markPaid(player)}
                        className="add-button"
                      >
                        {paid.includes(player.id) ? 'Paid' : 'Add to balance'}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <TableEmpty view={payoutView} noun="players" />
          <TablePagination view={payoutView} noun="players" />
        </section>
      )}
    </section>
  )
}
function money(value: number) {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  }).format(value)
}

function readPaidPayouts(): string[] {
  try {
    const saved = JSON.parse(
      localStorage.getItem('tornintel.paidPayouts') ?? '[]',
    ) as unknown
    return Array.isArray(saved)
      ? saved.filter((id): id is string => typeof id === 'string')
      : []
  } catch {
    return []
  }
}

async function fetchPayoutData<T>(
  path: string,
  apiKey: string,
  signal: AbortSignal,
): Promise<T> {
  if (!apiKey) throw new Error('Connect a Torn API key first.')
  const response = await fetch(path, {
    cache: 'no-store',
    headers: { 'X-Torn-Api-Key': apiKey },
    signal,
  })
  const payload = (await response.json()) as T & { error?: string }
  if (!response.ok || payload.error) {
    throw new Error(payload.error ?? 'Could not load payout data.')
  }
  return payload
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : 'Could not load payout data.'
}

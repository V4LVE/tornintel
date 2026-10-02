import { createFileRoute } from '@tanstack/react-router'
import { useEffect, useMemo, useState } from 'react'

export const Route = createFileRoute('/payouts')({ component: Payouts })

type Player = { id: string; name: string; warHits: number; nonWarHits: number }
type War = { id: number; start: number; end: number }

function Payouts() {
  const [players, setPlayers] = useState<Player[]>([])
  const [wars, setWars] = useState<War[]>([])
  const [warId, setWarId] = useState('')
  const [includeNonWar, setIncludeNonWar] = useState(true)
  const [earnings, setEarnings] = useState(0)
  const [rate, setRate] = useState(0)
  const [paid, setPaid] = useState<string[]>([])
  const [error, setError] = useState('')
  useEffect(() => {
    const key = localStorage.getItem('tornintel.apiKey') ?? ''
    setPaid(readPaidPayouts())
    const controller = new AbortController()
    async function loadWars() {
      try {
        const data = await fetchPayoutData<{ wars?: War[] }>(
          '/api/payout-hits',
          key,
          controller.signal,
        )
        setWars(data.wars ?? [])
        setWarId((current) => current || String(data.wars?.[0]?.id ?? ''))
      } catch (requestError) {
        if (!controller.signal.aborted) setError(errorMessage(requestError))
      }
    }
    void loadWars()
    return () => controller.abort()
  }, [])
  useEffect(() => {
    if (!warId) return
    const key = localStorage.getItem('tornintel.apiKey') ?? ''
    const controller = new AbortController()
    setPlayers([])
    async function loadPlayers() {
      try {
        const data = await fetchPayoutData<{ players?: Player[] }>(
          `/api/payout-hits?warId=${encodeURIComponent(warId)}`,
          key,
          controller.signal,
        )
        setError('')
        setPlayers(data.players ?? [])
      } catch (requestError) {
        if (!controller.signal.aborted) setError(errorMessage(requestError))
      }
    }
    void loadPlayers()
    return () => controller.abort()
  }, [warId])
  const totalHits = players.reduce(
    (sum, player) =>
      sum + player.warHits + (includeNonWar ? player.nonWarHits : 0),
    0,
  )
  const maxRate = totalHits ? earnings / totalHits : 0
  const appliedRate = Math.min(rate, maxRate)
  const payouts = useMemo(
    () =>
      players.map((player) => ({
        ...player,
        amount:
          (player.warHits + (includeNonWar ? player.nonWarHits : 0)) *
          appliedRate,
      })),
    [appliedRate, includeNonWar, players],
  )
  const totalPaid = payouts.reduce((sum, player) => sum + player.amount, 0)
  const remainder = Math.max(0, earnings - totalPaid)
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
    <main className="payout-page">
      <a href="/" className="back-link">
        ← War hospital
      </a>
      <h1>War payout</h1>
      <p>
        Select a ranked war. Non-war hits are attacks during that war against
        targets outside the opposing faction.
      </p>
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
          Pay per hit
          <input
            type="number"
            min="0"
            max={maxRate}
            value={rate || ''}
            onChange={(e) => setRate(Number(e.target.value))}
          />
        </label>
      </div>
      <label className="include-non-war">
        <input
          type="checkbox"
          checked={includeNonWar}
          onChange={(e) => setIncludeNonWar(e.target.checked)}
        />{' '}
        Include non-war chain-support hits
      </label>
      {rate > maxRate && (
        <p className="settings-error">
          Pay per hit was capped at {money(maxRate)}.
        </p>
      )}
      <div className="payout-summary">
        <span>
          Total hits <b>{totalHits}</b>
        </span>
        <span>
          Paid <b>{money(totalPaid)}</b>
        </span>
        <span>
          Left over <b>{money(remainder)}</b>
        </span>
      </div>
      {error ? (
        <p className="settings-error">{error}</p>
      ) : (
        <table className="payout-table">
          <thead>
            <tr>
              <th>PLAYER</th>
              <th>WAR HITS</th>
              <th>NON-WAR HITS</th>
              <th>PAYOUT</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {payouts.map((player) => (
              <tr key={player.id}>
                <td>{player.name}</td>
                <td>{player.warHits}</td>
                <td>{player.nonWarHits}</td>
                <td>{money(player.amount)}</td>
                <td>
                  <button
                    disabled={paid.includes(player.id) || player.amount <= 0}
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
      )}
    </main>
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

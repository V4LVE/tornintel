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
    setPaid(
      JSON.parse(
        localStorage.getItem('tornintel.paidPayouts') ?? '[]',
      ) as string[],
    )
    void fetch('/api/payout-hits', { headers: { 'X-Torn-Api-Key': key } }).then(
      async (response) => {
        const data = (await response.json()) as {
          wars?: War[]
          error?: string
        }
        if (!response.ok || data.error)
          setError(data.error ?? 'Could not load hits.')
        else {
          setWars(data.wars ?? [])
          setWarId(String(data.wars?.[0]?.id ?? ''))
        }
      },
    )
  }, [])
  useEffect(() => {
    if (!warId) return
    const key = localStorage.getItem('tornintel.apiKey') ?? ''
    void fetch(`/api/payout-hits?warId=${encodeURIComponent(warId)}`, {
      headers: { 'X-Torn-Api-Key': key },
    }).then(async (response) => {
      const data = (await response.json()) as {
        players?: Player[]
        error?: string
      }
      if (!response.ok || data.error)
        setError(data.error ?? 'Could not load war hits.')
      else {
        setError('')
        setPlayers(data.players ?? [])
      }
    })
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
    [appliedRate, players],
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

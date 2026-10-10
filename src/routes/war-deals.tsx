import { Link, createFileRoute } from '@tanstack/react-router'
import { useCallback, useEffect, useRef, useState } from 'react'
import {
  generateDealMessage,
  money,
  number,
  summarizeDeal,
} from '#/lib/war-deal'
import type { CacheEstimate } from '#/lib/war-deal'
import type { DealDefaults } from '#/lib/war-deal-data'

export const Route = createFileRoute('/war-deals')({
  component: WarDeals,
  head: () => ({ meta: [{ title: 'tornintel | War deals' }] }),
})

function WarDeals() {
  const [ourName, setOurName] = useState('NPC')
  const [theirName, setTheirName] = useState('Your faction')
  const [ourScore, setOurScore] = useState(8500)
  const [theirScore, setTheirScore] = useState(3000)
  const [rate, setRate] = useState(0)
  const [itemName, setItemName] = useState('Xanax')
  const [itemValue, setItemValue] = useState(0)
  const [offlineMinutes, setOfflineMinutes] = useState(15)
  const [paymentTiming, setPaymentTiming] = useState('')
  const [extraTerms, setExtraTerms] = useState('')
  const [defaults, setDefaults] = useState<DealDefaults | null>(null)
  const [loading, setLoading] = useState(false)
  const [loadError, setLoadError] = useState('')
  const [opponentId, setOpponentId] = useState('')
  const edited = useRef(new Set<string>())
  const [caches, setCaches] = useState<CacheEstimate[]>(
    ['Armor', 'Melee', 'Small arms', 'Medium arms', 'Heavy arms'].map(
      (name) => ({ name, ours: 0, theirs: 0, price: 0 }),
    ),
  )
  const loadDefaults = useCallback(
    async (opponent = '', signal?: AbortSignal) => {
      setLoading(true)
      setLoadError('')
      try {
        const key = localStorage.getItem('tornintel.apiKey') ?? ''
        if (!key)
          throw new Error(
            'Connect a Torn API key in Settings to automatically load war details, rewards, and prices. You can also fill in values manually.',
          )
        const response = await fetch(
          `/api/war-deal-defaults${opponent ? `?opponentId=${encodeURIComponent(opponent)}` : ''}`,
          { headers: { 'X-Torn-Api-Key': key }, signal },
        )
        const data = (await response.json()) as DealDefaults & {
          error?: string
        }
        if (!response.ok || data.error)
          throw new Error(data.error ?? 'Could not load Torn data.')
        if (signal?.aborted) return
        setDefaults(data)
        if (!edited.current.has('ourName')) setOurName(data.ourFaction.name)
        if (data.theirFaction && !edited.current.has('theirName'))
          setTheirName(data.theirFaction.name)
        if (data.war?.target && !edited.current.has('scores')) {
          setOurScore(3000 + data.war.target)
          setTheirScore(3000)
        }
        if (!edited.current.has('caches')) setCaches(data.caches)
        if (!edited.current.has('item'))
          setItemValue(
            data.items.find((item) => item.name === 'Xanax')?.price ?? 0,
          )
      } catch (error) {
        if (!signal?.aborted)
          setLoadError(
            error instanceof Error
              ? error.message
              : 'Could not load Torn data.',
          )
      } finally {
        if (!signal?.aborted) setLoading(false)
      }
    },
    [],
  )
  useEffect(() => {
    const controller = new AbortController()
    void loadDefaults('', controller.signal)
    return () => controller.abort()
  }, [loadDefaults])
  const summary = summarizeDeal(ourScore, theirScore, caches)
  const winningScore = Math.max(ourScore, theirScore)
  const losingScore = Math.min(ourScore, theirScore)
  const validScores = winningScore > losingScore && losingScore > 0
  const compensation = losingScore * rate
  const hasPricing = caches.some(
    (cache) => cache.price > 0 && cache.ours + cache.theirs > 0,
  )
  const hasCaches = summary.ourCaches + summary.theirCaches > 0
  function updateCache(
    index: number,
    field: 'ours' | 'theirs' | 'price',
    value: number,
  ) {
    edited.current.add('caches')
    setCaches((current) =>
      current.map((cache, i) =>
        i === index ? { ...cache, [field]: value } : cache,
      ),
    )
  }
  const messageOptions = {
    ourName,
    theirName,
    winningScore,
    losingScore,
    rate,
    itemName,
    itemValue,
    paymentTiming,
    offlineMinutes,
    extraTerms,
  }

  return (
    <main className="deal-page">
      <nav className="deal-nav" aria-label="War tools">
        <Link to="/" className="back-link">
          ← War hospital
        </Link>
        <Link to="/payouts" className="back-link">
          War payout →
        </Link>
      </nav>
      <header className="settings-heading">
        <span>WAR PLANNING</span>
        <h1>War deal calculator</h1>
        <p>
          Plan scores, estimate the rewards, and prepare a proposal for either
          outcome.
        </p>
      </header>

      <section className="panel deal-panel" aria-label="Automatic Torn data">
        <div className="deal-message-actions">
          <button
            className="add-button"
            disabled={loading}
            onClick={() => void loadDefaults(opponentId.trim())}
          >
            {loading ? 'Loading Torn values…' : 'Refresh Torn values'}
          </button>
          <Link className="back-link" to="/settings">
            API key settings
          </Link>
        </div>
        <p className="deal-note" role="status">
          {loading
            ? 'Fetching factions, the war target, recent cache rewards, and market prices.'
            : defaults
              ? `Loaded from Torn at ${new Date(defaults.fetchedAt).toLocaleTimeString()}. Your manual edits are preserved.`
              : 'Faction details and market values load automatically using your connected API key.'}
        </p>
        {loadError && (
          <p className="deal-error" role="alert">
            {loadError}
          </p>
        )}
        {defaults?.warnings.map((warning) => (
          <p className="deal-note" key={warning}>
            {warning}
          </p>
        ))}
        <details>
          <summary>Choose a different opponent</summary>
          <div className="deal-input-grid">
            <label>
              Opponent faction ID
              <input
                inputMode="numeric"
                value={opponentId}
                onChange={(e) => setOpponentId(e.target.value)}
                placeholder="Auto-detected from the current war"
              />
            </label>
          </div>
          <button
            className="text-button"
            disabled={loading}
            onClick={() => {
              edited.current.delete('theirName')
              edited.current.delete('caches')
              void loadDefaults(opponentId.trim())
            }}
          >
            Load opponent
          </button>
        </details>
      </section>

      <section className="panel deal-panel" aria-labelledby="scores-heading">
        <h2 id="scores-heading">Proposed scores</h2>
        <div className="deal-input-grid">
          <label>
            Our faction
            <input
              value={ourName}
              onChange={(e) => {
                edited.current.add('ourName')
                setOurName(e.target.value)
              }}
              maxLength={100}
            />
          </label>
          <label>
            Other faction
            <input
              value={theirName}
              onChange={(e) => {
                edited.current.add('theirName')
                setTheirName(e.target.value)
              }}
              maxLength={100}
            />
          </label>
          <NumberField
            label="Our target score"
            value={ourScore}
            onChange={(value) => {
              edited.current.add('scores')
              setOurScore(value)
            }}
          />
          <NumberField
            label="Their target score"
            value={theirScore}
            onChange={(value) => {
              edited.current.add('scores')
              setTheirScore(value)
            }}
          />
        </div>
        <p className="deal-note">
          These are each faction's total war scores. The winning net lead is{' '}
          {number(summary.lead)}. Check it against the war's current target
          before agreeing.
          {defaults?.war &&
            ` Current war #${defaults.war.id}: target lead ${number(defaults.war.target)}. The initial scores use that lead plus a proposed 3,000 losing score.`}
        </p>
        {!validScores && (
          <p className="deal-error" role="alert">
            Enter two different scores greater than zero to generate proposals.
          </p>
        )}
      </section>

      <section className="panel deal-panel" aria-labelledby="rewards-heading">
        <h2 id="rewards-heading">Estimated rewards</h2>
        <p className="deal-note">
          Cache quantities are taken from each faction's latest completed war;
          values use Torn's market prices. This historical baseline is not a
          prediction for the proposed scores. Rank, outcome, and participation
          can change the next reward.
        </p>
        {defaults?.baselines.map((baseline) => (
          <p
            className="deal-note"
            key={`${baseline.factionName}-${baseline.warId}`}
          >
            {baseline.factionName}: war #{baseline.warId},{' '}
            {baseline.won ? 'win' : 'loss'},{' '}
            {new Date(baseline.end * 1000).toLocaleDateString()}.
          </p>
        ))}
        <details>
          <summary>Adjust cache counts and prices</summary>
          <div className="deal-table-wrap">
            <table className="deal-table">
              <thead>
                <tr>
                  <th>Cache type</th>
                  <th>Our caches</th>
                  <th>Their caches</th>
                  <th>Price per cache ($)</th>
                </tr>
              </thead>
              <tbody>
                {caches.map((cache, index) => (
                  <tr key={cache.name}>
                    <th scope="row">{cache.name}</th>
                    {(['ours', 'theirs', 'price'] as const).map((field) => (
                      <td key={field}>
                        <input
                          aria-label={`${cache.name} ${field === 'price' ? 'price per cache' : field === 'ours' ? 'our cache count' : 'their cache count'}`}
                          type="number"
                          min="0"
                          max="1000000000000"
                          step="1"
                          value={cache[field] || ''}
                          placeholder="0"
                          onChange={(e) =>
                            updateCache(
                              index,
                              field,
                              readNumber(e.target.value),
                            )
                          }
                        />
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
        <div className="deal-summary">
          <div>
            <span>Estimated caches · combined</span>
            <strong>
              {hasCaches
                ? number(summary.ourCaches + summary.theirCaches)
                : 'Not set'}
            </strong>
            <small>
              Ours: {number(summary.ourCaches)} · Theirs:{' '}
              {number(summary.theirCaches)}
            </small>
          </div>
          <div>
            <span>Estimated value · combined</span>
            <strong>
              {hasPricing
                ? money(summary.ourValue + summary.theirValue)
                : 'Set cache prices'}
            </strong>
            <small>
              Ours: {money(summary.ourValue)} · Theirs:{' '}
              {money(summary.theirValue)}
            </small>
          </div>
          <div>
            <span>Planned war score points</span>
            <strong>{number(summary.totalScore)}</strong>
            <small>Combined score, including both factions</small>
          </div>
          <div>
            <span>Points reward</span>
            <strong>0</strong>
            <small>Torn removed Points rewards in May 2025</small>
          </div>
        </div>
        <p className="deal-note">
          <a
            href="https://wiki.torn.com/wiki/Ranked_War#Rewards"
            target="_blank"
            rel="noreferrer"
          >
            Torn reward rules ↗
          </a>{' '}
          · Prices are market averages. Any unpriced cache contributes $0.
        </p>
      </section>

      <section className="panel deal-panel" aria-labelledby="terms-heading">
        <h2 id="terms-heading">Optional compensation & terms</h2>
        <p className="deal-note">
          Compensation uses the losing faction's score, whichever side wins.
          Leave the rate and payment timing blank to omit payment information
          from the messages. Item prices load automatically; you can override
          them.
        </p>
        <details>
          <summary>Add payment information or customize terms</summary>
          <div className="deal-input-grid">
            <NumberField
              label="Compensation per losing score point ($)"
              value={rate}
              onChange={setRate}
            />
            <label>
              Compensation item
              <input
                value={itemName}
                onChange={(e) => {
                  edited.current.add('item')
                  setItemName(e.target.value)
                  setItemValue(
                    defaults?.items.find(
                      (item) =>
                        item.name.toLowerCase() ===
                        e.target.value.trim().toLowerCase(),
                    )?.price ?? 0,
                  )
                }}
                list="compensation-items"
                maxLength={100}
              />
            </label>
            <datalist id="compensation-items">
              {defaults?.items.map((item) => (
                <option key={item.id} value={item.name} />
              ))}
            </datalist>
            <NumberField
              label="Agreed value per item ($)"
              value={itemValue}
              onChange={(value) => {
                edited.current.add('item')
                setItemValue(value)
              }}
            />
            <NumberField
              label="Offliner minimum (minutes)"
              value={offlineMinutes}
              onChange={setOfflineMinutes}
            />
            <label>
              Payment timing
              <input
                value={paymentTiming}
                onChange={(e) => setPaymentTiming(e.target.value)}
                maxLength={200}
                placeholder="Optional, e.g. within 24 hours after the war"
              />
            </label>
            <label>
              Additional terms
              <input
                value={extraTerms}
                onChange={(e) => setExtraTerms(e.target.value)}
                maxLength={1000}
                placeholder="Optional contact, timing, or exceptions"
              />
            </label>
          </div>
        </details>
        {rate > 0 && (
          <p className="deal-note">
            Planned compensation:{' '}
            <b>{rate > 0 ? money(compensation) : 'Rate not set'}</b>
            {rate > 0 && itemValue > 0
              ? ` = ${number(Math.floor(compensation / itemValue))} ${itemName || 'items'} + ${money(compensation % itemValue)} cash. Whole items round down; the cash remainder preserves the agreed value.`
              : ''}
          </p>
        )}
      </section>

      <section aria-labelledby="messages-heading">
        <h2 id="messages-heading">Deal messages</h2>
        <p className="deal-note">
          Both alternatives use {number(winningScore)} for the winner and{' '}
          {number(losingScore)} for the loser. Preview and edit either proposal
          below; copy sends the exact visible text. Input changes refresh
          unedited drafts. Reset an edited draft to apply the latest inputs.
        </p>
        <div className="deal-messages">
          <DealMessage
            title={`${ourName.trim() || 'NPC'} takes the win`}
            generated={generateDealMessage({ ...messageOptions, weWin: true })}
            disabled={!validScores}
          />
          <DealMessage
            title={`${theirName.trim() || 'Your faction'} takes the win`}
            generated={generateDealMessage({ ...messageOptions, weWin: false })}
            disabled={!validScores}
          />
        </div>
      </section>
    </main>
  )
}

function readNumber(value: string) {
  const parsed = Number(value)
  return Number.isFinite(parsed)
    ? Math.min(1_000_000_000_000, Math.max(0, Math.floor(parsed)))
    : 0
}

function NumberField({
  label,
  value,
  onChange,
}: {
  label: string
  value: number
  onChange: (value: number) => void
}) {
  return (
    <label>
      {label}
      <input
        type="number"
        min="0"
        max="1000000000000"
        step="1"
        value={value || ''}
        placeholder="0"
        onChange={(e) => onChange(readNumber(e.target.value))}
      />
    </label>
  )
}

function DealMessage({
  title,
  generated,
  disabled,
}: {
  title: string
  generated: string
  disabled: boolean
}) {
  const [draft, setDraft] = useState<string | null>(null)
  const [status, setStatus] = useState('')
  const text = draft ?? generated
  async function copy() {
    try {
      await navigator.clipboard.writeText(text)
      setStatus('Copied to clipboard.')
    } catch {
      setStatus('Could not copy. Select the message and copy it manually.')
    }
  }
  return (
    <article className="panel deal-panel deal-message">
      <h3>{title}</h3>
      <textarea
        aria-label={`${title} message`}
        value={text}
        onChange={(e) => {
          setDraft(e.target.value)
          setStatus('')
        }}
        spellCheck
      />
      <div className="deal-message-actions">
        <button
          className="add-button"
          disabled={disabled || !text.trim()}
          onClick={() => void copy()}
        >
          Copy message
        </button>
        <button
          className="text-button"
          disabled={draft === null}
          onClick={() => {
            setDraft(null)
            setStatus('')
          }}
        >
          Reset to generated
        </button>
      </div>
      <p className="deal-note" role="status">
        {status}
      </p>
    </article>
  )
}

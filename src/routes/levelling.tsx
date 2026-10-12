import { createFileRoute } from '@tanstack/react-router'
import { useEffect, useMemo, useState } from 'react'
import type {
  DiscoveredPlayer,
  FfScouterEstimate,
  LevellingDiscoverResponse,
  LevellingEstimatesResponse,
  LevellingListResponse,
  LevellingStatsResponse,
  LevellingPlayer,
  LevellingTargetsResponse,
  LevellingTier,
} from '#/lib/levelling'
import { BattleStatsCell } from '#/components/battle-stats-cell'
import { FF_SCOUTER_KEY_STORAGE } from '#/lib/ffscouter'
import { LEVELLING_TIERS, playersInTier, tierForLevel } from '#/lib/levelling'

export const Route = createFileRoute('/levelling')({ component: Levelling })

const TIERS = Object.keys(LEVELLING_TIERS) as LevellingTier[]
const FF_SCOUTER_SETTING = 'tornintel.ffscouter'

type Estimates = Record<string, FfScouterEstimate | null>
type TbsStats = LevellingStatsResponse['stats']
type SortBy = 'listed' | 'tbs' | 'ffscouter'

function Levelling() {
  const [apiKey, setApiKey] = useState('')
  const [ffScouterKey, setFfScouterKey] = useState('')
  const [useFfScouter, setUseFfScouter] = useState(false)
  const [tier, setTier] = useState<LevellingTier>('tier1')
  const [players, setPlayers] = useState<LevellingPlayer[]>([])
  const [listWarning, setListWarning] = useState('')
  const [estimates, setEstimates] = useState<Estimates>({})
  const [estimatesError, setEstimatesError] = useState('')
  // null until loaded; players without Fair Fight evidence are left out.
  const [tbs, setTbs] = useState<TbsStats | null>(null)
  const [tbsNote, setTbsNote] = useState('')
  // The tier whose estimates have arrived, so a tier switch shows loading.
  const [tbsLoadedFor, setTbsLoadedFor] = useState('')
  const [sortBy, setSortBy] = useState<SortBy>('listed')
  const [result, setResult] = useState<LevellingTargetsResponse | null>(null)
  const [isSearching, setIsSearching] = useState(false)
  const [error, setError] = useState('')
  const { min, max } = LEVELLING_TIERS[tier]
  const pool = useMemo(() => {
    const inTier = playersInTier(tier, players)
    const value = (player: LevellingPlayer) =>
      sortBy === 'tbs'
        ? tbsValue(tbs?.[player.id])
        : (estimates[player.id]?.total ?? Infinity)
    if (sortBy === 'listed') return inTier
    return [...inTier].sort((a, b) => value(a) - value(b))
  }, [estimates, players, sortBy, tbs, tier])
  const ffScouterActive = useFfScouter && Boolean(ffScouterKey || apiKey)

  useEffect(() => {
    setApiKey(localStorage.getItem('tornintel.apiKey') ?? '')
    setFfScouterKey(localStorage.getItem(FF_SCOUTER_KEY_STORAGE) ?? '')
    setUseFfScouter(localStorage.getItem(FF_SCOUTER_SETTING) === '1')
    void apiRequest<LevellingListResponse>('/api/levelling-list')
      .then((list) => {
        applyList(list)
        setTier(busiestTier(list.players))
      })
      .catch((requestError: unknown) => setError(errorMessage(requestError)))
  }, [])

  // One FF Scouter request covers the whole tier; results are cached server-side.
  const tierIds = useMemo(
    () =>
      playersInTier(tier, players)
        .map((player) => player.id)
        .join(','),
    [players, tier],
  )
  useEffect(() => {
    if (!ffScouterActive || !tierIds) return
    const controller = new AbortController()
    setEstimatesError('')
    apiRequest<LevellingEstimatesResponse>(
      `/api/levelling-estimates?ids=${tierIds}`,
      { apiKey, ffScouterKey, signal: controller.signal },
    )
      .then((response) =>
        setEstimates((current) => ({ ...current, ...response.estimates })),
      )
      .catch((requestError: unknown) => {
        if (!controller.signal.aborted)
          setEstimatesError(errorMessage(requestError))
      })
    return () => controller.abort()
  }, [apiKey, ffScouterActive, ffScouterKey, tierIds])

  // The same Fair Fight estimates as the war hospital. Loading them also shares
  // the viewer's recent fights, so attacks on levelling targets improve them.
  useEffect(() => {
    if (!apiKey || !tierIds) return
    const controller = new AbortController()
    apiRequest<LevellingStatsResponse>(`/api/levelling-stats?ids=${tierIds}`, {
      apiKey,
      signal: controller.signal,
    })
      .then((response) => {
        setTbs((current) => ({ ...current, ...response.stats }))
        setTbsLoadedFor(tierIds)
        setTbsNote(response.sharedTbsReason ?? response.fairFightReason ?? '')
      })
      .catch((requestError: unknown) => {
        if (!controller.signal.aborted) setTbsNote(errorMessage(requestError))
      })
    return () => controller.abort()
  }, [apiKey, tierIds])

  function applyList(list: LevellingListResponse) {
    setPlayers(list.players)
    setListWarning(list.warning ?? '')
  }

  function toggleFfScouter(enabled: boolean) {
    setUseFfScouter(enabled)
    localStorage.setItem(FF_SCOUTER_SETTING, enabled ? '1' : '0')
    if (!enabled && sortBy === 'ffscouter') setSortBy('listed')
  }

  function selectTier(next: LevellingTier) {
    setTier(next)
    setResult(null)
    setError('')
  }

  async function findTargets() {
    setIsSearching(true)
    setError('')
    // Searching again skips the targets currently shown.
    const exclude = result?.targets.map((target) => target.id).join(',') ?? ''
    try {
      setResult(
        await apiRequest<LevellingTargetsResponse>(
          `/api/levelling-targets?tier=${tier}&exclude=${exclude}`,
          { apiKey },
        ),
      )
    } catch (requestError) {
      setError(errorMessage(requestError))
    } finally {
      setIsSearching(false)
    }
  }

  async function changeList(playerId: number, action: 'add' | 'remove') {
    applyList(
      await apiRequest<LevellingListResponse>('/api/levelling-list', {
        apiKey,
        ffScouterKey,
        method: 'POST',
        body: { playerId, action },
      }),
    )
  }

  async function removePlayer(player: LevellingPlayer) {
    if (!window.confirm(`Remove ${player.name} from the shared list?`)) return
    setError('')
    try {
      await changeList(player.id, 'remove')
    } catch (requestError) {
      setError(errorMessage(requestError))
    }
  }

  return (
    <main className="payout-page levelling-page">
      <a href="/" className="back-link">
        ← War hospital
      </a>
      <h1>Levelling targets</h1>
      <p>
        Low-stat players for levelling, grouped in tiers of ten levels. Pick a
        tier and get three random targets that Torn confirms are out of
        hospital, jail and travel.
      </p>

      <div className="levelling-tiers" role="tablist">
        {TIERS.map((key) => {
          const info = LEVELLING_TIERS[key]
          return (
            <button
              key={key}
              role="tab"
              aria-selected={key === tier}
              className={key === tier ? 'active' : undefined}
              onClick={() => selectTier(key)}
            >
              <strong>{info.name}</strong>
              <span>
                Level {info.min}–{info.max} ·{' '}
                {playersInTier(key, players).length} players
              </span>
            </button>
          )
        })}
      </div>

      {apiKey ? (
        <button
          className="add-button"
          onClick={() => void findTargets()}
          disabled={isSearching || !pool.length}
        >
          {isSearching
            ? 'Checking players...'
            : result
              ? 'Search again'
              : 'Find 3 targets'}
        </button>
      ) : (
        <p className="levelling-note">
          <a href="/settings">Connect a Torn API key</a> to check which players
          can be attacked right now. The full list is shown below.
        </p>
      )}
      {error && <p className="settings-error levelling-error">{error}</p>}

      {result && (
        <section className="levelling-results">
          <div className="levelling-cards">
            {result.targets.map((target) => (
              <article key={target.id} className="levelling-card">
                <header>
                  <a
                    href={profileUrl(target.id)}
                    target="_blank"
                    rel="noreferrer"
                  >
                    {target.name} [{target.id}]
                  </a>
                  <span>
                    Level {target.currentLevel}
                    {target.currentLevel !== target.level &&
                      ` (listed ${target.level})`}
                  </span>
                </header>
                <dl>
                  <div>
                    <dt>{target.str === null ? 'EST. AT ADD' : 'TOTAL'}</dt>
                    <dd>{formatStat(target.total)}</dd>
                  </div>
                  <div>
                    <dt>TBS</dt>
                    <dd>
                      <TbsText
                        stats={tbs?.[target.id]}
                        loaded={tbsLoadedFor === tierIds}
                      />
                    </dd>
                  </div>
                  {ffScouterActive && (
                    <div>
                      <dt>FF SCOUTER</dt>
                      <dd>
                        <EstimateText estimate={estimates[target.id]} />
                      </dd>
                    </div>
                  )}
                </dl>
                <a
                  className="attack-button"
                  href={attackUrl(target.id)}
                  target="_blank"
                  rel="noreferrer"
                >
                  Attack <span>&#8599;</span>
                </a>
              </article>
            ))}
          </div>
          {result.message && <p className="levelling-note">{result.message}</p>}
          {result.skipped.length > 0 && (
            <details className="levelling-skipped">
              <summary>
                {result.skipped.length} unavailable player
                {result.skipped.length === 1 ? '' : 's'} skipped
              </summary>
              <ul>
                {result.skipped.map((player) => (
                  <li key={player.id}>
                    {player.name} — {player.reason}
                  </li>
                ))}
              </ul>
            </details>
          )}
        </section>
      )}

      {(apiKey || ffScouterKey) && (
        <section className="levelling-ffscouter">
          <label>
            <input
              type="checkbox"
              checked={useFfScouter}
              onChange={(event) => toggleFfScouter(event.target.checked)}
            />{' '}
            Use FF Scouter estimates
          </label>
          <p className="levelling-note">
            Shows current battle stat estimates and lets you find new players
            for the list.{' '}
            {ffScouterKey
              ? 'Your FF Scouter key from Settings'
              : 'Your Torn API key'}{' '}
            is sent to{' '}
            <a href="https://ffscouter.com" target="_blank" rel="noreferrer">
              ffscouter.com
            </a>{' '}
            and must be registered there.{' '}
            <a href="/settings">
              {ffScouterKey ? 'Change' : 'Use a separate'} FF Scouter key
            </a>
          </p>
          {ffScouterActive && estimatesError && (
            <p className="settings-error levelling-error">{estimatesError}</p>
          )}
        </section>
      )}

      {ffScouterActive && (
        <DiscoverPanel
          key={tier}
          apiKey={apiKey}
          ffScouterKey={ffScouterKey}
          tier={tier}
          onAdd={(playerId) => changeList(playerId, 'add')}
        />
      )}

      <div className="levelling-list-heading">
        <h2>
          Level {min}–{max} list
        </h2>
        <label>
          Sort by
          <select
            value={sortBy}
            onChange={(event) => setSortBy(event.target.value as SortBy)}
          >
            <option value="listed">Listed total</option>
            {apiKey && <option value="tbs">TBS estimate</option>}
            {ffScouterActive && (
              <option value="ffscouter">FF Scouter estimate</option>
            )}
          </select>
        </label>
      </div>
      <p className="levelling-note">
        Listed stats are the snapshot recorded on the lists, sorted from lowest
        total. Players added here show FF Scouter's estimate from when they were
        added.
      </p>
      {listWarning && <p className="levelling-note">{listWarning}</p>}
      {apiKey && (
        <p className="levelling-note">
          TBS is estimated from Fair Fight in recorded attacks, the same as on
          the war hospital target list.
          {tbsNote && ` ${tbsNote}`}
        </p>
      )}
      <div className="table-wrap">
        <table className="payout-table levelling-table">
          <thead>
            <tr>
              <th>PLAYER</th>
              <th>LEVEL</th>
              <th>LISTED TOTAL</th>
              <th>STR</th>
              <th>DEF</th>
              <th>SPD</th>
              <th>DEX</th>
              {apiKey && <th>TBS</th>}
              {ffScouterActive && <th>FF SCOUTER</th>}
              <th>TIER</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {pool.map((player) => (
              <ListRow
                key={player.id}
                player={player}
                estimate={ffScouterActive ? estimates[player.id] : undefined}
                showEstimate={ffScouterActive}
                tbs={tbs?.[player.id]}
                showTbs={Boolean(apiKey)}
                tbsLoaded={tbsLoadedFor === tierIds}
                onRemove={apiKey ? () => void removePlayer(player) : undefined}
              />
            ))}
          </tbody>
        </table>
      </div>
    </main>
  )
}

function DiscoverPanel({
  apiKey,
  ffScouterKey,
  tier,
  onAdd,
}: {
  apiKey: string
  ffScouterKey: string
  tier: LevellingTier
  onAdd: (playerId: number) => Promise<void>
}) {
  const [maxFairFight, setMaxFairFight] = useState('1.5')
  const [inactiveOnly, setInactiveOnly] = useState(true)
  const [found, setFound] = useState<DiscoveredPlayer[] | null>(null)
  const [busyId, setBusyId] = useState<number | null>(null)
  const [isSearching, setIsSearching] = useState(false)
  const [error, setError] = useState('')
  const { min, max } = LEVELLING_TIERS[tier]

  async function search() {
    setIsSearching(true)
    setError('')
    try {
      const response = await apiRequest<LevellingDiscoverResponse>(
        `/api/levelling-discover?tier=${tier}&maxff=${maxFairFight}&inactive=${inactiveOnly ? 1 : 0}`,
        { apiKey, ffScouterKey },
      )
      setFound(response.players)
    } catch (requestError) {
      setError(errorMessage(requestError))
    } finally {
      setIsSearching(false)
    }
  }

  async function add(player: DiscoveredPlayer) {
    setBusyId(player.id)
    setError('')
    try {
      await onAdd(player.id)
      setFound(
        (current) =>
          current?.map((item) =>
            item.id === player.id ? { ...item, onList: true } : item,
          ) ?? null,
      )
    } catch (requestError) {
      setError(errorMessage(requestError))
    } finally {
      setBusyId(null)
    }
  }

  return (
    <section className="levelling-discover">
      <h2>Find new players</h2>
      <p className="levelling-note">
        Searches FF Scouter for level {min}–{max} players with a low fair fight
        against you. Added players are shared with everyone using tornintel.
      </p>
      <div className="payout-inputs">
        <label>
          Max fair fight
          <select
            value={maxFairFight}
            onChange={(event) => setMaxFairFight(event.target.value)}
          >
            <option value="1.25">1.25</option>
            <option value="1.5">1.5</option>
            <option value="2">2</option>
            <option value="3">3</option>
          </select>
        </label>
        <label className="levelling-inline">
          <input
            type="checkbox"
            checked={inactiveOnly}
            onChange={(event) => setInactiveOnly(event.target.checked)}
          />{' '}
          Inactive 14+ days only
        </label>
        <button
          className="add-button"
          onClick={() => void search()}
          disabled={isSearching}
        >
          {isSearching ? 'Searching...' : 'Search FF Scouter'}
        </button>
      </div>
      {error && <p className="settings-error levelling-error">{error}</p>}
      {found && !found.length && (
        <p className="levelling-note">No players matched these filters.</p>
      )}
      {found && found.length > 0 && (
        <div className="table-wrap">
          <table className="payout-table levelling-table">
            <thead>
              <tr>
                <th>PLAYER</th>
                <th>LEVEL</th>
                <th>FF SCOUTER</th>
                <th>LAST ACTION</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {found.map((player) => (
                <tr key={player.id}>
                  <td>
                    <a
                      href={profileUrl(player.id)}
                      target="_blank"
                      rel="noreferrer"
                    >
                      {player.name}
                    </a>
                  </td>
                  <td>{player.level}</td>
                  <td>
                    <EstimateText estimate={player.estimate} />
                  </td>
                  <td>
                    {player.lastActionAt
                      ? relativeDays(player.lastActionAt)
                      : '—'}
                  </td>
                  <td>
                    <button
                      className="add-button"
                      disabled={player.onList || busyId !== null}
                      onClick={() => void add(player)}
                    >
                      {player.onList
                        ? 'On list'
                        : busyId === player.id
                          ? 'Adding...'
                          : 'Add to list'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}

function ListRow({
  player,
  estimate,
  showEstimate,
  tbs,
  showTbs,
  tbsLoaded,
  onRemove,
}: {
  player: LevellingPlayer
  estimate: FfScouterEstimate | null | undefined
  showEstimate: boolean
  tbs: TbsStats[string] | undefined
  showTbs: boolean
  tbsLoaded: boolean
  onRemove?: () => void
}) {
  return (
    <tr>
      <td>
        <a href={profileUrl(player.id)} target="_blank" rel="noreferrer">
          {player.name}
        </a>
      </td>
      <td>{player.level}</td>
      <td>{formatStat(player.total)}</td>
      <td>{formatStat(player.str)}</td>
      <td>{formatStat(player.def)}</td>
      <td>{formatStat(player.spd)}</td>
      <td>{formatStat(player.dex)}</td>
      {showTbs && (
        <td>
          {tbs ? (
            <BattleStatsCell
              estimate={tbs.battleStats}
              contributors={tbs.contributors}
            />
          ) : (
            <TbsText stats={undefined} loaded={tbsLoaded} />
          )}
        </td>
      )}
      {showEstimate && (
        <td>
          <EstimateText estimate={estimate} />
        </td>
      )}
      <td
        title={player.addedBy ? `Added by ${player.addedBy.name}` : undefined}
      >
        {tierName(player.level)}
        {player.addedBy && ' · added'}
      </td>
      <td className="levelling-actions">
        <a
          className="attack-button"
          href={attackUrl(player.id)}
          target="_blank"
          rel="noreferrer"
        >
          Attack <span>&#8599;</span>
        </a>
        {onRemove && (
          <button
            className="text-button"
            onClick={onRemove}
            aria-label={`Remove ${player.name} from the list`}
          >
            Remove
          </button>
        )}
      </td>
    </tr>
  )
}

// Compact TBS for target cards; the list uses the full war hospital cell.
function TbsText({
  stats,
  loaded,
}: {
  stats: TbsStats[string] | undefined
  loaded: boolean
}) {
  if (!loaded) return <>…</>
  if (!stats) return <span className="battle-stats-method">No FF evidence</span>
  const { estimate, lowerBound, upperBound, explanation } = stats.battleStats
  const value = estimate ?? lowerBound ?? upperBound
  if (value === null) return <>No usable FF</>
  return (
    <span title={explanation}>
      {estimate === null && lowerBound !== null ? '' : '~'}
      {value.toLocaleString('en-US', { notation: 'compact' })}
      {estimate === null && lowerBound !== null && '+'}
    </span>
  )
}

function tbsValue(stats: TbsStats[string] | undefined) {
  const estimate = stats?.battleStats
  return estimate?.estimate ?? estimate?.lowerBound ?? Infinity
}

function EstimateText({
  estimate,
}: {
  estimate: FfScouterEstimate | null | undefined
}) {
  // undefined: not loaded yet; null: FF Scouter has no estimate for the player.
  if (estimate === undefined) return <>…</>
  if (estimate === null) return <>No estimate</>
  return (
    <span
      title={
        estimate.updatedAt
          ? `Updated ${new Date(estimate.updatedAt).toLocaleString()}`
          : undefined
      }
    >
      {estimate.human}
      {estimate.fairFight !== null && ` · FF ${estimate.fairFight.toFixed(2)}`}
    </span>
  )
}

async function apiRequest<T>(
  path: string,
  {
    apiKey,
    ffScouterKey,
    method = 'GET',
    body,
    signal,
  }: {
    apiKey?: string
    ffScouterKey?: string
    method?: 'GET' | 'POST'
    body?: unknown
    signal?: AbortSignal
  } = {},
): Promise<T> {
  const headers: Record<string, string> = {}
  if (apiKey) headers['X-Torn-Api-Key'] = apiKey
  if (ffScouterKey) headers['X-FfScouter-Key'] = ffScouterKey
  if (body !== undefined) headers['Content-Type'] = 'application/json'
  const response = await fetch(path, {
    method,
    cache: 'no-store',
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
    signal,
  })
  const payload = (await response.json()) as T & { error?: string }
  if (!response.ok || payload.error) {
    throw new Error(payload.error ?? 'The request failed. Try again shortly.')
  }
  return payload
}

function errorMessage(error: unknown) {
  return error instanceof Error
    ? error.message
    : 'The request failed. Try again shortly.'
}

function tierName(level: number) {
  const tier = tierForLevel(level)
  return tier ? LEVELLING_TIERS[tier].name : '—'
}

// Open on the tier with the most players rather than an empty one.
function busiestTier(players: LevellingPlayer[]) {
  return TIERS.reduce((best, tier) =>
    playersInTier(tier, players).length > playersInTier(best, players).length
      ? tier
      : best,
  )
}

function attackUrl(id: number) {
  return 'https://www.torn.com/page.php?sid=attack&user2ID=' + id
}

function profileUrl(id: number) {
  return 'https://www.torn.com/profiles.php?XID=' + id
}

function formatStat(value: number | null) {
  return value === null ? '—' : value.toLocaleString('en-US')
}

function relativeDays(timestamp: number) {
  const days = Math.floor((Date.now() - timestamp) / 86400000)
  return days < 1 ? 'Today' : `${days} day${days === 1 ? '' : 's'} ago`
}

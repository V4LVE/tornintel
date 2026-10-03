import { createFileRoute } from '@tanstack/react-router'
import type { FormEvent } from 'react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import type { BattleStatsEstimate } from '#/lib/battle-stats/estimator'
import { verifyTornUser } from '#/lib/torn-user'
import type { UserProfile } from '#/lib/torn-user'
import type { ChainTargetResponse } from '#/lib/chain-target'

export const Route = createFileRoute('/')({ component: Home })

type Target = {
  id: string
  name: string
  level: number
  status: 'Ready' | 'In hospital' | 'Traveling'
  detail: string
  releaseAt: number
  reason: string
  lastSeen: string
  hospitalRecommended: boolean
  priority: 'High' | 'Medium' | 'Low'
  battleStats: BattleStatsEstimate
}

type FactionMembersResponse = {
  faction: { id: number; name: string; tag: string }
  members: Target[]
  fairFightStatus: 'READY' | 'NO_RECENT_FIGHTS' | 'UNAVAILABLE'
  fairFightReason?: string
  fetchedAt: number
  error?: string
}

type CombatBarsResponse = {
  energy?: {
    current: number
    maximum: number
    increment: number
    interval: number
    tick_time: number
    full_time: number
  }
  chain?: {
    current: number
    max: number
    timeout: number
    cooldown: number
  } | null
  fetchedAt?: number
  error?: string
}

const filters = ['All targets', 'In hospital', 'Ready', 'Traveling'] as const

function Home() {
  const [filter, setFilter] = useState<(typeof filters)[number]>('All targets')
  const [query, setQuery] = useState('')
  const [targets, setTargets] = useState<Target[]>([])
  const [fairFightStatus, setFairFightStatus] = useState<
    FactionMembersResponse['fairFightStatus'] | null
  >(null)
  const [fairFightReason, setFairFightReason] = useState('')
  const [factionName, setFactionName] = useState('Enemy faction')
  const [synced, setSynced] = useState('Waiting for data')
  const [error, setError] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [clock, setClock] = useState(0)
  const [factionId, setFactionId] = useState('')
  const [factionInput, setFactionInput] = useState('')
  const [apiKey, setApiKey] = useState('')
  const [isPaused, setIsPaused] = useState(false)
  const [hasInitialized, setHasInitialized] = useState(false)
  const [user, setUser] = useState<UserProfile | null>(null)
  const [isAuthenticating, setIsAuthenticating] = useState(false)
  const [authenticationError, setAuthenticationError] = useState('')
  const [combatBars, setCombatBars] = useState<CombatBarsResponse | null>(null)
  const [combatBarsError, setCombatBarsError] = useState('')
  const [chainTarget, setChainTarget] = useState<ChainTargetResponse | null>(
    null,
  )
  const [chainTargetError, setChainTargetError] = useState('')
  const [isFindingChainTarget, setIsFindingChainTarget] = useState(false)

  async function findChainTarget() {
    if (isFindingChainTarget) return
    setIsFindingChainTarget(true)
    setChainTargetError('')
    const previousId = chainTarget?.target?.id
    setChainTarget(null)
    try {
      const response = await fetch(
        '/api/chain-target' + (previousId ? `?excludeId=${previousId}` : ''),
        { cache: 'no-store', headers: { 'X-Torn-Api-Key': apiKey } },
      )
      const payload = (await response.json()) as ChainTargetResponse
      if (!response.ok || payload.error) {
        throw new Error(payload.error ?? 'Unable to find a keep-alive target.')
      }
      setChainTarget(payload)
    } catch (requestError) {
      setChainTargetError(
        requestError instanceof Error
          ? requestError.message
          : 'Unable to find a keep-alive target.',
      )
    } finally {
      setIsFindingChainTarget(false)
    }
  }

  const refreshCombatBars = useCallback(async (key: string) => {
    try {
      const response = await fetch('/api/combat-bars', {
        cache: 'no-store',
        headers: { 'X-Torn-Api-Key': key },
      })
      const payload = (await response.json()) as CombatBarsResponse
      if (
        !response.ok ||
        payload.error ||
        !payload.energy ||
        !payload.fetchedAt
      ) {
        throw new Error(
          payload.error ?? 'Unable to load energy and chain data.',
        )
      }
      setCombatBars(payload)
      setCombatBarsError('')
    } catch (requestError) {
      setCombatBarsError(
        requestError instanceof Error
          ? requestError.message
          : 'Unable to load energy and chain data.',
      )
    }
  }, [])

  const authenticate = useCallback(async (key: string) => {
    const requestedApiKey = key.trim()
    if (!requestedApiKey) {
      setAuthenticationError('Enter a Torn API key to continue.')
      return false
    }

    setIsAuthenticating(true)
    setAuthenticationError('')
    try {
      const verifiedUser = await verifyTornUser(requestedApiKey)
      window.localStorage.setItem('tornintel.apiKey', requestedApiKey)
      setApiKey(requestedApiKey)
      setUser(verifiedUser)
      return true
    } catch (requestError) {
      setAuthenticationError(
        requestError instanceof Error
          ? requestError.message
          : 'Unable to verify your Torn public API key.',
      )
      return false
    } finally {
      setIsAuthenticating(false)
    }
  }, [])

  const refreshTargets = useCallback(
    async (idOverride = factionId, apiKeyOverride = apiKey) => {
      const requestedFactionId = idOverride.trim()
      const requestedApiKey = apiKeyOverride.trim()

      if (!requestedApiKey) {
        setError('Enter your Torn API key to begin tracking.')
        return
      }

      setIsLoading(true)
      setError('')

      try {
        const response = await fetch(
          '/api/faction-members?factionId=' +
            encodeURIComponent(requestedFactionId),
          {
            cache: 'no-store',
            headers: { 'X-Torn-Api-Key': requestedApiKey },
          },
        )
        const payload = (await response.json()) as FactionMembersResponse

        if (!response.ok || payload.error) {
          throw new Error(payload.error ?? 'Unable to load faction members.')
        }

        setTargets(payload.members)
        setFairFightStatus(payload.fairFightStatus)
        setFairFightReason(payload.fairFightReason ?? '')
        setFactionName(payload.faction.name)
        setFactionId(String(payload.faction.id))
        setFactionInput(String(payload.faction.id))
        window.localStorage.setItem(
          'tornintel.trackedFactionId',
          String(payload.faction.id),
        )
        setSynced('Just now')
        setClock(Date.now())
      } catch (requestError) {
        const message =
          requestError instanceof Error
            ? requestError.message
            : 'Unable to load faction members.'
        console.error('[tornintel] Failed to load faction members', {
          factionId: requestedFactionId,
          message,
        })
        setError(message)
      } finally {
        setIsLoading(false)
      }
    },
    [apiKey, factionId],
  )

  useEffect(() => {
    const savedFactionId = window.localStorage.getItem(
      'tornintel.trackedFactionId',
    )
    const initialFactionId =
      savedFactionId && /^\d{1,10}$/.test(savedFactionId)
        ? savedFactionId
        : '56833'
    setFactionId(initialFactionId)
    setFactionInput(initialFactionId)
    const savedApiKey = window.localStorage.getItem('tornintel.apiKey') ?? ''
    setIsPaused(
      window.localStorage.getItem('tornintel.hospitalPaused') === 'true',
    )
    setHasInitialized(true)
    if (savedApiKey) void authenticate(savedApiKey)
  }, [authenticate])

  useEffect(() => {
    if (!hasInitialized || !apiKey || !user || isPaused) return

    void refreshTargets()
    const refreshTimer = window.setInterval(() => void refreshTargets(), 30000)

    return () => {
      window.clearInterval(refreshTimer)
    }
  }, [apiKey, hasInitialized, isPaused, refreshTargets, user])

  useEffect(() => {
    if (!hasInitialized || !apiKey || !user) return
    void refreshCombatBars(apiKey)
    const refreshTimer = window.setInterval(
      () => void refreshCombatBars(apiKey),
      30000,
    )
    return () => window.clearInterval(refreshTimer)
  }, [apiKey, hasInitialized, refreshCombatBars, user])

  useEffect(() => {
    setClock(Date.now())
    const clockTimer = window.setInterval(() => setClock(Date.now()), 1000)
    return () => window.clearInterval(clockTimer)
  }, [])

  function trackFaction(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const nextFactionId = factionInput.trim()

    if (!/^\d{1,10}$/.test(nextFactionId)) {
      const message = 'Enter a numeric Torn faction ID.'
      console.warn('[tornintel] Invalid faction ID entered', {
        factionId: factionInput,
      })
      setError(message)
      return
    }

    const factionChanged = nextFactionId !== factionId
    setFactionId(nextFactionId)
    setError('')
    if (!isPaused && !factionChanged) {
      void refreshTargets(nextFactionId)
    }
  }

  function togglePause() {
    const nextIsPaused = !isPaused
    setIsPaused(nextIsPaused)
    window.localStorage.setItem(
      'tornintel.hospitalPaused',
      String(nextIsPaused),
    )
  }

  const visibleTargets = useMemo(
    () =>
      targets.filter((target) => {
        const matchesFilter =
          filter === 'All targets' || target.status === filter
        const matchesQuery =
          target.name.toLowerCase().includes(query.toLowerCase()) ||
          target.id.includes(query)
        return matchesFilter && matchesQuery
      }),
    [filter, query, targets],
  )

  const hospitalTargets = useMemo(
    () =>
      targets
        .filter((target) => target.status === 'In hospital')
        .sort((left, right) => left.releaseAt - right.releaseAt),
    [targets],
  )
  const readyTargets = targets.filter((target) => target.status === 'Ready')
  const nextRelease = hospitalTargets.at(0)
  const hospitalExitsSoon = hospitalTargets.filter(
    (target) => target.releaseAt - clock <= 600000,
  ).length
  const onlineReadyTargets = readyTargets.filter((target) =>
    target.lastSeen.includes('0 minutes'),
  ).length
  const chainDeadline =
    combatBars?.chain && combatBars.fetchedAt
      ? combatBars.fetchedAt + combatBars.chain.timeout * 1000
      : 0
  const activeChain = Boolean(
    combatBars?.chain?.current && chainDeadline > clock,
  )
  const energyNow =
    combatBars?.energy && combatBars.fetchedAt
      ? projectEnergy(combatBars.energy, combatBars.fetchedAt, clock)
      : null
  const chainTargetFresh = Boolean(
    chainTarget?.target && clock - chainTarget.fetchedAt < 30000,
  )

  if (!hasInitialized || (isAuthenticating && !user)) {
    return <ApiKeyGate isLoading />
  }

  if (!user) {
    return (
      <ApiKeyGate
        error={authenticationError}
        isLoading={isAuthenticating}
        onSubmit={authenticate}
      />
    )
  }

  return (
    <main className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <span className="brand-mark">TI</span>
          <span>tornintel</span>
        </div>
        <div className="workspace-label">OPERATIONS</div>
        <nav className="nav-list">
          <a className="nav-item active" href="#hospital">
            <span className="nav-icon">+</span> War hospital
            <span className="nav-count">{hospitalTargets.length}</span>
          </a>
          <a className="nav-item" href="#targets">
            <span className="nav-icon">#</span> Target list
          </a>
          <a className="nav-item" href="/payouts">
            <span className="nav-icon">$</span> War payout
          </a>
          <a className="nav-item" href="#intel">
            <span className="nav-icon">i</span> Intel reports
            <span className="soon">Soon</span>
          </a>
        </nav>
        <div className="sidebar-bottom">
          <div className="workspace-label">WORKSPACE</div>
          <a className="nav-item" href="/settings">
            <span className="nav-icon">*</span> Settings
          </a>
          <div className="profile">
            <div className="avatar">{user.name.charAt(0)}</div>
            <div>
              <strong>{user.name}</strong>
              <span>
                Level {user.level} · {user.factionName}
              </span>
            </div>
            <span className="profile-more">...</span>
          </div>
        </div>
      </aside>

      <section className="content" id="hospital">
        <header className="topbar">
          <div className="breadcrumb">
            <span>Operations</span>
            <b>/</b>
            <strong>War hospital</strong>
          </div>
          <div className="top-actions">
            <span className="connection">
              <i /> {error ? 'Torn API unavailable' : 'Torn API connected'}
            </span>
            <button className="icon-button" aria-label="Notifications">
              &#9678;
            </button>
            <button className="help-button">?</button>
          </div>
        </header>

        <div className="page-heading">
          <div>
            <div className="eyebrow">
              {factionName.toUpperCase()} <span className="live-dot" /> LIVE
              MONITOR
            </div>
            <h1>War hospital</h1>
            <p>
              Track opposing members and strike the moment they leave the
              hospital.
            </p>
            <form className="faction-picker" onSubmit={trackFaction}>
              <label htmlFor="faction-id">Track faction</label>
              <input
                id="faction-id"
                inputMode="numeric"
                value={factionInput}
                onChange={(event) => setFactionInput(event.target.value)}
                placeholder="Faction ID"
              />
              <button type="submit" disabled={isLoading}>
                Track
              </button>
            </form>
          </div>
          <div className="sync-block">
            <span>Last synced</span>
            <strong>{synced}</strong>
            <button
              onClick={() => void refreshTargets()}
              className="refresh-button"
              disabled={isLoading || isPaused || !apiKey}
            >
              <span>&#8635;</span> {isLoading ? 'Refreshing' : 'Refresh'}
            </button>
            <button
              onClick={togglePause}
              className={isPaused ? 'pause-button paused' : 'pause-button'}
              aria-pressed={isPaused}
              title="Pause or resume War Hospital API polling"
            >
              <span aria-hidden="true">{isPaused ? '▶' : 'Ⅱ'}</span>
              {isPaused
                ? 'Resume hospital tracking'
                : 'Pause hospital tracking'}
            </button>
          </div>
        </div>

        <div className="stat-grid">
          <Stat
            label="Total members"
            value={String(targets.length)}
            detail={factionName}
            icon="/"
            tone="blue"
          />
          <Stat
            label="In hospital"
            value={String(hospitalTargets.length)}
            detail={String(hospitalExitsSoon) + ' out within 10 min'}
            icon="+"
            tone="orange"
          />
          <Stat
            label="Ready to hit"
            value={String(readyTargets.length)}
            detail={String(onlineReadyTargets) + ' online right now'}
            icon="!"
            tone="green"
          />
          <Stat
            label="Next release"
            value={
              nextRelease
                ? formatRelease(nextRelease.releaseAt, clock)
                : '--:--'
            }
            detail={
              nextRelease
                ? nextRelease.name + ' - level ' + String(nextRelease.level)
                : 'No members hospitalized'
            }
            icon="~"
            tone="purple"
          />
        </div>

        <div className="combat-grid">
          <section
            className="panel combat-panel"
            id="chain"
            aria-label="Faction chain tracker"
          >
            <div className="combat-heading">
              <div>
                <span className="combat-kicker">YOUR FACTION</span>
                <h2>Chain tracker</h2>
              </div>
              <span className="combat-indicator">
                {activeChain ? 'Active' : 'Idle'}
              </span>
            </div>
            {activeChain && combatBars?.chain ? (
              <>
                <div className="combat-value">
                  {combatBars.chain.current.toLocaleString()} <span>hits</span>
                </div>
                <div className="combat-timers">
                  <div>
                    <span>Chain ends in</span>
                    <strong>{formatCountdown(chainDeadline, clock)}</strong>
                  </div>
                </div>
              </>
            ) : (
              <p className="combat-empty">
                {combatBars
                  ? 'No active chain'
                  : combatBarsError
                    ? 'Chain unavailable'
                    : 'Loading chain…'}
              </p>
            )}
            {combatBarsError && (
              <p className="combat-error">{combatBarsError}</p>
            )}
            <div className="chain-keep-alive">
              <h3>Keep the chain alive</h3>
              <p>
                Find a random available player you beat in the last 14 days.
              </p>
              <button
                className="refresh-button"
                onClick={() => void findChainTarget()}
                disabled={isFindingChainTarget}
              >
                {isFindingChainTarget
                  ? 'Finding target…'
                  : chainTarget?.target
                    ? 'Find another target'
                    : 'Find keep-alive target'}
              </button>
              <div aria-live="polite" aria-busy={isFindingChainTarget}>
                {chainTarget?.target && (
                  <div className="chain-target">
                    <strong>{chainTarget.target.name}</strong>
                    <span>
                      #{chainTarget.target.id} · Level{' '}
                      {chainTarget.target.level}
                    </span>
                    <span>
                      Last beaten{' '}
                      {new Date(
                        chainTarget.target.lastWonAt,
                      ).toLocaleDateString()}
                      . Previous wins suggest you can beat them again.
                    </span>
                    {chainTargetFresh &&
                    (!energyNow || energyNow.current >= 25) ? (
                      <a
                        className="attack-button"
                        href={
                          'https://www.torn.com/page.php?sid=attack&user2ID=' +
                          chainTarget.target.id
                        }
                        target="_blank"
                        rel="noreferrer"
                        onClick={() => {
                          setChainTarget(null)
                          window.setTimeout(
                            () => void refreshCombatBars(apiKey),
                            5000,
                          )
                        }}
                      >
                        Attack <span>&#8599;</span>
                      </a>
                    ) : (
                      <span>
                        {!chainTargetFresh
                          ? 'Status check expired. Find a fresh target.'
                          : 'You need 25 energy to attack.'}
                      </span>
                    )}
                  </div>
                )}
                {chainTarget?.message && <p>{chainTarget.message}</p>}
                {chainTargetError && (
                  <p className="combat-error">{chainTargetError}</p>
                )}
              </div>
            </div>
          </section>
          <section className="panel combat-panel" aria-label="Energy bar">
            <div className="combat-heading">
              <div>
                <span className="combat-kicker">YOUR ENERGY</span>
                <h2>Energy</h2>
              </div>
            </div>
            {combatBars?.energy && energyNow ? (
              <>
                <div className="combat-value">
                  {energyNow.current} <span>/ {combatBars.energy.maximum}</span>
                </div>
                <div
                  className="energy-track"
                  role="progressbar"
                  aria-label="Energy"
                  aria-valuenow={Math.min(
                    energyNow.current,
                    combatBars.energy.maximum,
                  )}
                  aria-valuemin={0}
                  aria-valuemax={combatBars.energy.maximum}
                >
                  <div
                    style={{
                      width: `${Math.min(100, Math.max(0, (energyNow.current / combatBars.energy.maximum) * 100))}%`,
                    }}
                  />
                </div>
                <div className="combat-timers">
                  <div>
                    <span>Next refill</span>
                    <strong>
                      {energyNow.current >= combatBars.energy.maximum
                        ? 'Full'
                        : formatCountdown(energyNow.nextTickAt, clock)}
                    </strong>
                  </div>
                  <div>
                    <span>Full refill</span>
                    <strong>
                      {energyNow.current >= combatBars.energy.maximum
                        ? 'Full'
                        : formatCountdown(
                            combatBars.fetchedAt! +
                              combatBars.energy.full_time * 1000,
                            clock,
                          )}
                    </strong>
                  </div>
                </div>
              </>
            ) : (
              <p className="combat-empty">
                {combatBarsError ? 'Energy unavailable' : 'Loading energy…'}
              </p>
            )}
            {combatBarsError && (
              <p className="combat-error">{combatBarsError}</p>
            )}
          </section>
        </div>

        <section className="panel target-panel" id="targets">
          <div className="panel-header">
            <div>
              <h2>Opposing members</h2>
              <p>
                Live member status from {factionName}. Stat estimates require a
                usable Fair Fight score from your recent fights.
              </p>
            </div>
            <button
              className="add-button"
              onClick={() => void refreshTargets()}
              disabled={isLoading || isPaused || !apiKey}
            >
              <span>&#8635;</span> Sync now
            </button>
          </div>
          {fairFightStatus === 'UNAVAILABLE' && (
            <p className="ff-evidence-note">
              Fair Fight data is unavailable. {fairFightReason}
            </p>
          )}
          {fairFightStatus === 'NO_RECENT_FIGHTS' && (
            <p className="ff-evidence-note">
              No recent fights were found. Torn cannot provide a Fair Fight
              estimate for a player you have not fought.
            </p>
          )}
          <div className="toolbar">
            <div className="filter-tabs">
              {filters.map((item) => (
                <button
                  key={item}
                  className={
                    filter === item ? 'filter-tab selected' : 'filter-tab'
                  }
                  onClick={() => setFilter(item)}
                >
                  {item}
                  {item === 'All targets' && <em>{targets.length}</em>}
                </button>
              ))}
            </div>
            <label className="search">
              <span>&#9906;</span>
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search by name or ID"
              />
            </label>
          </div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>MEMBER</th>
                  <th>STATUS</th>
                  <th>RELEASES IN</th>
                  <th>REASON</th>
                  <th>LAST SEEN</th>
                  <th>EST. TBS</th>
                  <th>PRIORITY</th>
                  <th>
                    <span className="sr-only">Action</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {visibleTargets.map((target) => (
                  <TargetRow key={target.id} target={target} clock={clock} />
                ))}
              </tbody>
            </table>
          </div>
          {isLoading && targets.length === 0 && (
            <div className="empty-state">Loading faction members...</div>
          )}
          {error && (
            <div className="empty-state">Could not load live data. {error}</div>
          )}
          {!isLoading && !error && visibleTargets.length === 0 && (
            <div className="empty-state">No members match this view.</div>
          )}
          <div className="panel-footer">
            <span>
              Showing {visibleTargets.length} of {targets.length} members
            </span>
            <span>
              {isPaused
                ? 'Hospital tracking paused'
                : 'Auto-refreshes every 30 seconds'}
            </span>
          </div>
        </section>
        <footer className="footer-note">
          <span className="shield">&#10003;</span> Data comes directly from Torn
          and{' '}
          {isPaused
            ? 'War hospital tracking is paused.'
            : 'is refreshed automatically every 30 seconds.'}
        </footer>
      </section>
    </main>
  )
}

function ApiKeyGate({
  error = '',
  isLoading = false,
  onSubmit,
}: {
  error?: string
  isLoading?: boolean
  onSubmit?: (apiKey: string) => Promise<boolean>
}) {
  return (
    <main className="api-key-gate">
      <section className="api-key-card">
        <div className="brand">
          <span className="brand-mark">TI</span>
          <span>tornintel</span>
        </div>
        <h1>{isLoading ? 'Checking your key…' : 'Connect to Torn'}</h1>
        <p>
          Enter a Torn API key to use tornintel. A Limited key also lets us use
          your recent Fair Fight history for battle-stat estimates. It stays in
          this browser and is used only for your requests.
        </p>
        {!isLoading && onSubmit && (
          <form
            className="api-key-login"
            onSubmit={(event) => {
              event.preventDefault()
              const formData = new FormData(event.currentTarget)
              void onSubmit(String(formData.get('apiKey') ?? ''))
            }}
          >
            <label htmlFor="login-api-key">Torn API key</label>
            <input
              id="login-api-key"
              name="apiKey"
              type="password"
              autoComplete="off"
              autoFocus
              placeholder="Paste a Limited Torn API key"
            />
            {error && <p className="login-error">{error}</p>}
            <button type="submit">Connect</button>
          </form>
        )}
      </section>
    </main>
  )
}

function Stat({
  label,
  value,
  detail,
  icon,
  tone,
}: {
  label: string
  value: string
  detail: string
  icon: string
  tone: string
}) {
  return (
    <div className="stat-card">
      <div className={['stat-icon', tone].join(' ')}>{icon}</div>
      <div>
        <span className="stat-label">{label}</span>
        <div className="stat-value">{value}</div>
        <span className="stat-detail">{detail}</span>
      </div>
    </div>
  )
}

function TargetRow({ target, clock }: { target: Target; clock: number }) {
  const width = Math.max(
    12,
    Math.min(92, 100 - ((target.releaseAt - clock) / 1800000) * 100),
  )
  const release =
    target.status === 'In hospital'
      ? formatRelease(target.releaseAt, clock)
      : '--'
  const avatarClass = [
    'member-avatar',
    target.status === 'Ready' ? 'ready-avatar' : '',
  ]
    .filter(Boolean)
    .join(' ')
  const statusClass = [
    'status',
    target.status.toLowerCase().replace(' ', '-'),
  ].join(' ')
  const priorityClass = ['priority', target.priority.toLowerCase()].join(' ')

  return (
    <tr>
      <td>
        <div className="member">
          <div className={avatarClass}>{target.name.charAt(0)}</div>
          <div>
            <strong>{target.name}</strong>
            <span>
              #{target.id} <b>-</b> Level {target.level}
            </span>
          </div>
        </div>
      </td>
      <td>
        <span className={statusClass}>
          <i />
          {target.status}
        </span>
        <small>{target.detail}</small>
      </td>
      <td>
        <strong
          className={
            target.status === 'Ready' || release === 'Ready' ? 'ready-time' : ''
          }
        >
          {release}
        </strong>
        {target.status === 'In hospital' && release !== 'Ready' && (
          <div className="release-bar">
            <i style={{ width: String(width) + '%' }} />
          </div>
        )}
      </td>
      <td>
        <span className="reason">{target.reason}</span>
      </td>
      <td>
        <div className="last-seen">
          <span>{target.lastSeen}</span>
          {target.hospitalRecommended && (
            <span className="hospital-recommended">Hospital recommended</span>
          )}
        </div>
      </td>
      <td>
        <BattleStatsCell estimate={target.battleStats} />
      </td>
      <td>
        <span className={priorityClass}>
          <i />
          {target.priority}
        </span>
      </td>
      <td>
        <a
          className="attack-button"
          href={'https://www.torn.com/page.php?sid=attack&user2ID=' + target.id}
          target="_blank"
          rel="noreferrer"
        >
          Attack <span>&#8599;</span>
        </a>
      </td>
    </tr>
  )
}

function BattleStatsCell({ estimate }: { estimate: BattleStatsEstimate }) {
  if (estimate.estimate === null) {
    const cappedBound = estimate.sources.includes('FAIR_FIGHT')
      ? estimate.lowerBound !== null && estimate.lowerBound > 0
        ? `${formatBattleStats(estimate.lowerBound)}+`
        : estimate.upperBound !== null
          ? `≤${formatBattleStats(estimate.upperBound)}`
          : null
      : null
    return (
      <div className="battle-stats" title={estimate.explanation}>
        <strong>{cappedBound ?? 'No usable FF'}</strong>
        <span className="battle-stats-method">
          {cappedBound ? 'Capped FF · bound only' : 'No recent FF evidence'}
        </span>
      </div>
    )
  }

  const range =
    estimate.upperBound !== null && estimate.lowerBound === estimate.upperBound
      ? formatBattleStats(estimate.estimate)
      : estimate.upperBound === null &&
          estimate.estimate === estimate.lowerBound
        ? `${formatBattleStats(estimate.lowerBound)}+`
        : `~${formatBattleStats(estimate.estimate)}`
  const bounds = estimate.sources.includes('FALLBACK')
    ? null
    : estimate.upperBound === null && estimate.estimate === estimate.lowerBound
      ? null
      : estimate.upperBound === null
        ? `${formatBattleStats(estimate.lowerBound ?? 0)}+`
        : estimate.lowerBound === estimate.upperBound
          ? null
          : `${formatBattleStats(estimate.lowerBound ?? 0)}–${formatBattleStats(estimate.upperBound)}`
  const method = estimate.sources.includes('EXACT')
    ? 'Exact stats'
    : estimate.sources.includes('SPY') &&
        !estimate.sources.includes('FAIR_FIGHT')
      ? 'Spy estimate'
      : estimate.sources.includes('FAIR_FIGHT')
        ? estimate.diagnostics.observationsAccepted > 0
          ? `FF-based · ${estimate.diagnostics.observationsAccepted} hit${estimate.diagnostics.observationsAccepted === 1 ? '' : 's'}`
          : 'Capped FF bound'
        : estimate.sources.includes('FALLBACK')
          ? 'Profile estimate · FF not used'
          : 'Rank estimate'
  return (
    <div className="battle-stats" title={estimate.explanation}>
      <strong>{range}</strong>
      <span className="battle-stats-method">{method}</span>
      <span>
        {bounds ? `${bounds} · ` : ''}
        {estimate.bss === null ? '' : `BSS ${Math.round(estimate.bss)} · `}
        {estimate.confidenceLevel.replace('_', ' ')}
      </span>
    </div>
  )
}

function formatBattleStats(value: number) {
  if (value >= 1_000_000_000) return `${(value / 1_000_000_000).toFixed(1)}b`
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}m`
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}k`
  return Math.round(value).toLocaleString()
}

function formatRelease(releaseAt: number, now: number) {
  const seconds = Math.max(0, Math.ceil((releaseAt - now) / 1000))
  if (seconds === 0) return 'Ready'

  const hours = Math.floor(seconds / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  const remainingSeconds = seconds % 60
  if (hours > 0)
    return String(hours) + 'h ' + String(minutes).padStart(2, '0') + 'm'
  return (
    String(minutes).padStart(2, '0') +
    ':' +
    String(remainingSeconds).padStart(2, '0')
  )
}

function formatCountdown(deadline: number, now: number) {
  const seconds = Math.max(0, Math.ceil((deadline - now) / 1000))
  const hours = Math.floor(seconds / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  const remainingSeconds = seconds % 60
  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, '0')}:${String(remainingSeconds).padStart(2, '0')}`
    : `${String(minutes).padStart(2, '0')}:${String(remainingSeconds).padStart(2, '0')}`
}

function projectEnergy(
  energy: NonNullable<CombatBarsResponse['energy']>,
  fetchedAt: number,
  now: number,
) {
  const firstTickAt = fetchedAt + energy.tick_time * 1000
  if (
    energy.current >= energy.maximum ||
    energy.interval <= 0 ||
    energy.increment <= 0 ||
    now < firstTickAt
  ) {
    return { current: energy.current, nextTickAt: firstTickAt }
  }
  const ticks = 1 + Math.floor((now - firstTickAt) / (energy.interval * 1000))
  return {
    current: Math.min(
      energy.maximum,
      energy.current + ticks * energy.increment,
    ),
    nextTickAt: firstTickAt + ticks * energy.interval * 1000,
  }
}

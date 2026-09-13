import { createFileRoute } from '@tanstack/react-router'
import type { FormEvent } from 'react'
import { useCallback, useEffect, useMemo, useState } from 'react'

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
  priority: 'High' | 'Medium' | 'Low'
}

type FactionMembersResponse = {
  faction: { id: number; name: string; tag: string }
  members: Target[]
  fetchedAt: number
  error?: string
}

type UserProfile = {
  id: number
  name: string
  level: number
  factionName: string
}

type UserResponse = { user?: UserProfile; error?: string }

const filters = ['All targets', 'In hospital', 'Ready', 'Traveling'] as const

function Home() {
  const [filter, setFilter] = useState<(typeof filters)[number]>('All targets')
  const [query, setQuery] = useState('')
  const [targets, setTargets] = useState<Target[]>([])
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

  const authenticate = useCallback(async (key: string) => {
    const requestedApiKey = key.trim()
    if (!requestedApiKey) {
      setAuthenticationError('Enter a Torn public API key to continue.')
      return false
    }

    setIsAuthenticating(true)
    setAuthenticationError('')
    try {
      const response = await fetch('/api/user', {
        cache: 'no-store',
        headers: { 'X-Torn-Api-Key': requestedApiKey },
      })
      const payload = (await response.json()) as UserResponse
      if (!response.ok || !payload.user || payload.error) {
        throw new Error(
          payload.error ?? 'Unable to verify your Torn public API key.',
        )
      }

      window.localStorage.setItem('tornintel.apiKey', requestedApiKey)
      setApiKey(requestedApiKey)
      setUser(payload.user)
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
          <a className="nav-item" href="#chain">
            <span className="nav-icon">&#8594;</span> Chain tracker
            <span className="soon">Soon</span>
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
            <button onClick={togglePause} className="pause-button">
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

        <section className="panel target-panel" id="targets">
          <div className="panel-header">
            <div>
              <h2>Opposing members</h2>
              <p>Live member status from {factionName}</p>
            </div>
            <button
              className="add-button"
              onClick={() => void refreshTargets()}
              disabled={isLoading || isPaused || !apiKey}
            >
              <span>&#8635;</span> Sync now
            </button>
          </div>
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
          Enter a Torn public API key to use tornintel. It stays in this browser
          and is used only for your requests.
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
            <label htmlFor="login-api-key">Torn public API key</label>
            <input
              id="login-api-key"
              name="apiKey"
              type="password"
              autoComplete="off"
              autoFocus
              placeholder="Paste your public API key"
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
        <span className="last-seen">{target.lastSeen}</span>
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

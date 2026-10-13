import { Link, createFileRoute } from '@tanstack/react-router'
import type { PointerEvent } from 'react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { PageHeading } from '#/components/app-shell'
import { useSession } from '#/components/session'
import {
  SortHeader,
  TableEmpty,
  TablePagination,
  TableToolbar,
} from '#/components/table-controls'
import { useTableView } from '#/lib/hooks/use-table-view'
import type { TableFilter } from '#/lib/hooks/use-table-view'
import {
  RANGES,
  STAT_META,
  STAT_NAMES,
  describeBuild,
  effectiveValue,
  formatCompactStat,
  formatSignedStat,
  toStatPoint,
} from '#/lib/battle-stats/my-stats'
import type {
  FactionStatsMember,
  FactionStatsResponse,
  MyStatsResponse,
  RangeKey,
  StatName,
  StatPoint,
  StatSharingResponse,
} from '#/models/my-stats'
import { clearStatHistory, useStatHistory } from '#/lib/hooks/use-stat-history'
import { useVisiblePolling } from '#/lib/hooks/use-visible-polling'
import { FF_SCOUTER_KEY_STORAGE } from '#/lib/ffscouter/ffscouter'

export const Route = createFileRoute('/my-stats')({ component: MyStats })

const REFRESH_MS = 5 * 60 * 1000
const ICON_CLASS: Record<StatName, string> = {
  strength: 'orange',
  defense: 'purple',
  speed: 'green',
  dexterity: 'blue',
}

function MyStats() {
  // AppShell only renders pages once a verified key exists.
  const { apiKey } = useSession()
  const [stats, setStats] = useState<MyStatsResponse | null>(null)
  const [error, setError] = useState('')
  const [range, setRange] = useState<RangeKey>('30d')
  const [mode, setMode] = useState<'total' | 'stats'>('total')
  const [recentGain, setRecentGain] = useState(0)
  const lastTotal = useRef<number | null>(null)
  const [historyRevision, setHistoryRevision] = useState(0)

  const refresh = useCallback(
    async (signal?: AbortSignal) => {
      try {
        const response = await fetch('/api/my-stats', {
          cache: 'no-store',
          headers: { 'X-Torn-Api-Key': apiKey },
          signal,
        })
        const payload = (await response.json()) as MyStatsResponse & {
          error?: string
        }
        if (!response.ok || payload.error)
          throw new Error(payload.error ?? 'Unable to load your battle stats.')
        const total = payload.battlestats.total
        if (lastTotal.current !== null && total > lastTotal.current)
          setRecentGain(total - lastTotal.current)
        lastTotal.current = total
        setStats(payload)
        setError('')
      } catch (requestError) {
        if (signal?.aborted) return
        setError(
          requestError instanceof Error
            ? requestError.message
            : 'Unable to load your battle stats.',
        )
      }
    },
    [apiKey],
  )
  useVisiblePolling(refresh, Boolean(apiKey), REFRESH_MS)

  const current = useMemo(
    () =>
      stats ? toStatPoint(stats.battlestats, stats.fetchedAt / 1000) : null,
    [stats],
  )
  const history = useStatHistory(
    apiKey,
    stats?.profile.id,
    range,
    current,
    historyRevision,
  )
  const first = history.points.length > 1 ? history.points[0] : null
  const build = current ? describeBuild(current) : null

  return (
    <section className="payout-page my-stats-page">
      <PageHeading
        eyebrow="PERSONAL"
        title="My battle stats"
        actions={
          <button
            type="button"
            className="text-button"
            onClick={() => void refresh()}
          >
            Refresh
          </button>
        }
      >
        {stats
          ? `${stats.profile.name} · Level ${stats.profile.level} · updated ${new Date(stats.fetchedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`
          : 'Loading your battle stats…'}
        {recentGain > 0 && (
          <b className="my-stats-gain">
            {' '}
            {formatSignedStat(recentGain)} since the last refresh
          </b>
        )}
      </PageHeading>

      {error && <p className="settings-error">{error}</p>}
      {history.error && (
        <p className="settings-error">
          Some history couldn't be loaded: {history.error}
        </p>
      )}

      {stats && current && (
        <>
          <div className="stat-grid">
            {STAT_NAMES.map((stat) => {
              const detail = stats.battlestats[stat]
              const modifierText = detail.modifiers
                .map(
                  (modifier) =>
                    `${modifier.value > 0 ? '+' : ''}${modifier.value}% ${modifier.effect}`,
                )
                .join('\n')
              return (
                <div className="stat-card" key={stat}>
                  <span className={`stat-icon ${ICON_CLASS[stat]}`}>
                    {STAT_META[stat].short.charAt(0)}
                  </span>
                  <div>
                    <div className="stat-label" title={STAT_META[stat].blurb}>
                      {STAT_META[stat].label}
                    </div>
                    <div
                      className="stat-value"
                      title={detail.value.toLocaleString()}
                    >
                      {formatCompactStat(detail.value)}
                    </div>
                    <div
                      className="stat-detail"
                      title={modifierText || 'No active modifiers'}
                    >
                      Effective{' '}
                      {formatCompactStat(
                        effectiveValue(detail.value, detail.modifier),
                      )}{' '}
                      ({detail.modifier >= 0 ? '+' : ''}
                      {detail.modifier}%)
                      {first && (
                        <>
                          {' · '}
                          {formatSignedStat(current[stat] - first[stat])}{' '}
                          {RANGES[range].label}
                        </>
                      )}
                    </div>
                  </div>
                </div>
              )
            })}
          </div>

          <section className="panel my-stats-panel">
            <div className="panel-header my-stats-panel-header">
              <div>
                <h2>
                  Total {formatCompactStat(current.total)}
                  {first && (
                    <span className="my-stats-gain">
                      {' '}
                      {formatSignedStat(current.total - first.total)}
                    </span>
                  )}
                </h2>
                <p>
                  {history.isLoading
                    ? `Loading history ${Math.round(history.progress * 100)}%`
                    : 'History comes from Torn and is cached in this browser.'}
                </p>
              </div>
              <div className="my-stats-controls">
                <div className="table-tabs">
                  {(['total', 'stats'] as const).map((value) => (
                    <button
                      key={value}
                      type="button"
                      className={`table-tab ${mode === value ? 'selected' : ''}`}
                      onClick={() => setMode(value)}
                    >
                      {value === 'total' ? 'Total' : 'Per stat'}
                    </button>
                  ))}
                </div>
                <div className="table-tabs">
                  {(Object.keys(RANGES) as RangeKey[]).map((value) => (
                    <button
                      key={value}
                      type="button"
                      className={`table-tab ${range === value ? 'selected' : ''}`}
                      onClick={() => setRange(value)}
                    >
                      {RANGES[value].label}
                    </button>
                  ))}
                </div>
              </div>
            </div>
            <ProgressChart points={history.points} mode={mode} />
          </section>

          {build && (
            <section className="panel my-stats-panel">
              <div className="panel-header">
                <div>
                  <h2>{build.title}</h2>
                  <p>{build.description}</p>
                </div>
              </div>
              <div className="my-stats-balance">
                <div className="my-stats-balance-labels">
                  <span>
                    Offense (STR + SPD) {Math.round(build.offenseShare * 100)}%
                  </span>
                  <span>
                    {Math.round((1 - build.offenseShare) * 100)}% Defense (DEF +
                    DEX)
                  </span>
                </div>
                <div className="my-stats-balance-track">
                  <i style={{ width: `${build.offenseShare * 100}%` }} />
                </div>
              </div>
            </section>
          )}
        </>
      )}

      <FactionStats
        apiKey={apiKey}
        onSharingEnabled={() => {
          // Refetch history through the server so it is stored for the faction.
          if (stats) clearStatHistory(stats.profile.id)
          setHistoryRevision((revision) => revision + 1)
        }}
      />
    </section>
  )
}

// Shared with the levelling page: whether the viewer opted in to FF Scouter.
const FF_SCOUTER_SETTING = 'tornintel.ffscouter'

async function requestJson<T>(
  url: string,
  apiKey: string,
  init?: RequestInit & { ffScouterKey?: string },
) {
  const { ffScouterKey, ...options } = init ?? {}
  const response = await fetch(url, {
    ...options,
    cache: 'no-store',
    headers: {
      'X-Torn-Api-Key': apiKey,
      ...(ffScouterKey ? { 'X-FfScouter-Key': ffScouterKey } : {}),
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
    },
  })
  const payload = (await response.json()) as T & { error?: string }
  if (!response.ok || payload.error)
    throw new Error(payload.error ?? 'Request failed.')
  return payload
}

const errorMessage = (error: unknown, fallback: string) =>
  error instanceof Error ? error.message : fallback

const MEMBER_FILTERS: TableFilter<FactionStatsMember, string>[] = [
  { id: 'all', label: 'All members' },
  { id: 'sharing', label: 'Sharing', test: (member) => !!member.shared },
  { id: 'not-sharing', label: 'Not sharing', test: (member) => !member.shared },
]

// Shared readings inside the chosen range, oldest first.
function pointsSince(member: FactionStatsMember, since: number) {
  return (
    member.shared?.history.filter((point) => point.timestamp >= since) ?? []
  )
}

// Gain over the range; undefined without two readings in it, so it sorts last.
function rangeGain(member: FactionStatsMember, since: number) {
  const points = pointsSince(member, since)
  return member.shared && points.length > 1
    ? member.shared.current.total - points[0].total
    : undefined
}

function FactionStats({
  apiKey,
  onSharingEnabled,
}: {
  apiKey: string
  onSharingEnabled: () => void
}) {
  const [data, setData] = useState<FactionStatsResponse | null>(null)
  const [error, setError] = useState('')
  const [isLoading, setIsLoading] = useState(true)
  const [isSharing, setIsSharing] = useState<boolean | null>(null)
  const [factionName, setFactionName] = useState<string | null>(null)
  const [sharingError, setSharingError] = useState('')
  const [isSaving, setIsSaving] = useState(false)
  const [expanded, setExpanded] = useState<string | null>(null)
  const [range, setRange] = useState<RangeKey>('30d')
  const [ffScouterKey, setFfScouterKey] = useState('')
  const [useFfScouter, setUseFfScouter] = useState<boolean | null>(null)

  useEffect(() => {
    setFfScouterKey(localStorage.getItem(FF_SCOUTER_KEY_STORAGE) ?? '')
    setUseFfScouter(localStorage.getItem(FF_SCOUTER_SETTING) === '1')
  }, [])

  const load = useCallback(
    async (signal?: AbortSignal) => {
      if (useFfScouter === null) return
      setIsLoading(true)
      try {
        const payload = await requestJson<FactionStatsResponse>(
          `/api/faction-stats${useFfScouter ? '?ffscouter=1' : ''}`,
          apiKey,
          { ffScouterKey, signal },
        )
        if (signal?.aborted) return
        setData(payload)
        setError('')
      } catch (requestError) {
        if (signal?.aborted) return
        setError(errorMessage(requestError, 'Unable to load your faction.'))
      } finally {
        if (!signal?.aborted) setIsLoading(false)
      }
    },
    [apiKey, ffScouterKey, useFfScouter],
  )

  useEffect(() => {
    const controller = new AbortController()
    void load(controller.signal)
    return () => controller.abort()
  }, [load])

  useEffect(() => {
    const controller = new AbortController()
    requestJson<StatSharingResponse>('/api/stat-sharing', apiKey, {
      signal: controller.signal,
    })
      .then((sharing) => {
        setIsSharing(sharing.isSharing)
        setFactionName(sharing.factionName ?? null)
      })
      .catch((requestError: unknown) => {
        if (controller.signal.aborted) return
        setSharingError(
          errorMessage(requestError, 'Unable to load your sharing setting.'),
        )
      })
    return () => controller.abort()
  }, [apiKey])

  function toggleFfScouter(enabled: boolean) {
    setUseFfScouter(enabled)
    localStorage.setItem(FF_SCOUTER_SETTING, enabled ? '1' : '0')
  }

  async function updateSharing(enabled: boolean) {
    if (
      !enabled &&
      !window.confirm(
        'Stop sharing? Your stored stats and progression are deleted for everyone.',
      )
    )
      return
    setIsSaving(true)
    setSharingError('')
    try {
      const result = await requestJson<StatSharingResponse>(
        '/api/stat-sharing',
        apiKey,
        { method: 'POST', body: JSON.stringify({ enabled }) },
      )
      setIsSharing(result.isSharing)
      if (result.isSharing) onSharingEnabled()
      await load()
    } catch (requestError) {
      setSharingError(
        errorMessage(requestError, 'Unable to update your sharing setting.'),
      )
    } finally {
      setIsSaving(false)
    }
  }

  const since = Date.now() / 1000 - RANGES[range].days * 86_400
  // Without a sort the list keeps the server's order, best known total first.
  const memberView = useTableView(data?.members ?? [], {
    search: (member) => [member.name, member.id],
    filters: MEMBER_FILTERS,
    sorts: {
      member: (member) => member.name,
      level: (member) => member.level,
      estimate: (member) => member.estimate?.total,
      total: (member) => member.shared?.current.total,
      gain: (member) => rangeGain(member, since),
    },
  })
  const sharedCount =
    data?.members.filter((member) => member.shared).length ?? 0
  const faction = factionName ?? 'your faction'

  return (
    <>
      <section className="panel my-stats-panel">
        <div className="panel-header my-stats-panel-header">
          <div>
            <h2>Share with your faction</h2>
            <p>
              {isSharing
                ? `Members of ${faction} can see your real stats and progression. They update whenever you open this page.`
                : `Let members of ${faction} see your real battle stats and how they progress. Turning this off deletes what was shared.`}
            </p>
          </div>
          <label className="share-toggle">
            <input
              type="checkbox"
              checked={Boolean(isSharing)}
              disabled={isSharing === null || isSaving}
              onChange={(event) => void updateSharing(event.target.checked)}
            />
            <span aria-hidden />
            {isSaving ? 'Saving…' : isSharing ? 'Sharing' : 'Not sharing'}
          </label>
        </div>
        {sharingError && <p className="settings-error">{sharingError}</p>}
      </section>

      <section className="panel my-stats-panel">
        <div className="panel-header my-stats-panel-header">
          <div>
            <h2>{data ? data.faction.name : 'Your faction'}</h2>
            <p>
              {data
                ? `${data.members.length} members · ${sharedCount} sharing real stats`
                : 'Real stats from members who share, plus optional FF Scouter estimates.'}
            </p>
            <label className="my-stats-ffscouter">
              <input
                type="checkbox"
                checked={Boolean(useFfScouter)}
                onChange={(event) => toggleFfScouter(event.target.checked)}
              />{' '}
              Use FF Scouter estimates
            </label>
            <p>
              {ffScouterKey
                ? 'Your FF Scouter key from Settings'
                : 'Your Torn API key'}{' '}
              is sent to{' '}
              <a href="https://ffscouter.com" target="_blank" rel="noreferrer">
                ffscouter.com
              </a>{' '}
              and must be registered there.{' '}
              <Link to="/settings">
                {ffScouterKey ? 'Change' : 'Use a separate'} FF Scouter key
              </Link>
            </p>
          </div>
          <div className="my-stats-controls">
            <div className="table-tabs">
              {(Object.keys(RANGES) as RangeKey[]).map((value) => (
                <button
                  key={value}
                  type="button"
                  className={`table-tab ${range === value ? 'selected' : ''}`}
                  onClick={() => setRange(value)}
                >
                  {RANGES[value].label}
                </button>
              ))}
            </div>
            <button
              type="button"
              className="text-button"
              disabled={isLoading}
              onClick={() => void load()}
            >
              {isLoading ? 'Loading…' : 'Refresh'}
            </button>
          </div>
        </div>
        {data?.ffScouterReason && (
          <p className="ff-evidence-note">{data.ffScouterReason}</p>
        )}
        {data?.sharingReason && (
          <p className="ff-evidence-note">{data.sharingReason}</p>
        )}

        {data && data.members.length > 0 && (
          <>
            <TableToolbar view={memberView} />
            <div className="table-wrap">
              <table className="faction-stats-table">
                <thead>
                  <tr>
                    <SortHeader view={memberView} column="member">
                      MEMBER
                    </SortHeader>
                    <SortHeader view={memberView} column="level">
                      LEVEL
                    </SortHeader>
                    {useFfScouter && (
                      <SortHeader view={memberView} column="estimate">
                        FF SCOUTER EST.
                      </SortHeader>
                    )}
                    <SortHeader view={memberView} column="total">
                      REAL TOTAL
                    </SortHeader>
                    <SortHeader view={memberView} column="gain">
                      GAIN {RANGES[range].label}
                    </SortHeader>
                    <th>
                      <span className="sr-only">Progress</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {memberView.pageItems.map((member) => (
                    <FactionMemberRow
                      key={member.id}
                      member={member}
                      isViewer={member.id === data.viewer.id}
                      isExpanded={expanded === member.id}
                      onToggle={() =>
                        setExpanded((current) =>
                          current === member.id ? null : member.id,
                        )
                      }
                      since={since}
                      showEstimate={Boolean(useFfScouter)}
                    />
                  ))}
                </tbody>
              </table>
            </div>
            <TableEmpty view={memberView} noun="members" />
            <TablePagination view={memberView} noun="members">
              Real totals and gains come from members who share. Others sort
              last.
            </TablePagination>
          </>
        )}
        {isLoading && !data && (
          <div className="empty-state">Loading faction members…</div>
        )}
        {error && <div className="empty-state">{error}</div>}
      </section>
    </>
  )
}

function FactionMemberRow({
  member,
  isViewer,
  isExpanded,
  onToggle,
  since,
  showEstimate,
}: {
  member: FactionStatsMember
  isViewer: boolean
  isExpanded: boolean
  onToggle: () => void
  since: number
  showEstimate: boolean
}) {
  const { estimate, shared } = member
  const [mode, setMode] = useState<'total' | 'stats'>('total')
  const points = useMemo(() => pointsSince(member, since), [member, since])
  const first = points.length > 1 ? points[0] : null
  const gain = rangeGain(member, since)

  return (
    <>
      <tr className={isExpanded ? 'faction-stats-open' : undefined}>
        <td>
          <a
            className="faction-stats-name"
            href={`https://www.torn.com/profiles.php?XID=${member.id}`}
            target="_blank"
            rel="noreferrer"
          >
            {member.name}
          </a>
          {isViewer && <span className="faction-stats-you">You</span>}
        </td>
        <td>{member.level}</td>
        {showEstimate && (
          <td
            title={
              estimate?.updatedAt
                ? `Fair fight ${estimate.fairFight ?? '?'} · updated ${new Date(estimate.updatedAt).toLocaleDateString()}`
                : undefined
            }
          >
            {estimate ? estimate.human : '—'}
          </td>
        )}
        <td>
          {shared ? (
            <strong title={shared.current.total.toLocaleString()}>
              {formatCompactStat(shared.current.total)}
            </strong>
          ) : (
            <span className="faction-stats-muted">Not shared</span>
          )}
        </td>
        <td>
          {gain !== undefined ? (
            <span className="my-stats-gain">{formatSignedStat(gain)}</span>
          ) : (
            <span className="faction-stats-muted">—</span>
          )}
        </td>
        <td>
          {shared && (
            <button
              type="button"
              className="text-button"
              aria-expanded={isExpanded}
              onClick={onToggle}
            >
              {isExpanded ? 'Hide' : 'Progress'}
            </button>
          )}
        </td>
      </tr>
      {isExpanded && shared && (
        <tr className="faction-stats-detail">
          <td colSpan={showEstimate ? 6 : 5}>
            <div className="faction-stats-breakdown">
              {STAT_NAMES.map((stat) => (
                <div key={stat}>
                  <span style={{ color: STAT_META[stat].color }}>
                    {STAT_META[stat].short}
                  </span>
                  <strong>{formatCompactStat(shared.current[stat])}</strong>
                  {first && (
                    <em>
                      {formatSignedStat(shared.current[stat] - first[stat])}
                    </em>
                  )}
                </div>
              ))}
              <div className="table-tabs">
                {(['total', 'stats'] as const).map((value) => (
                  <button
                    key={value}
                    type="button"
                    className={`table-tab ${mode === value ? 'selected' : ''}`}
                    onClick={() => setMode(value)}
                  >
                    {value === 'total' ? 'Total' : 'Per stat'}
                  </button>
                ))}
              </div>
            </div>
            <ProgressChart points={points} mode={mode} />
            <p className="faction-stats-updated">
              Last updated {new Date(shared.updatedAt).toLocaleString()}
            </p>
          </td>
        </tr>
      )}
    </>
  )
}

const TOTAL_COLOR = '#f26b4f'

function ProgressChart({
  points,
  mode,
}: {
  points: StatPoint[]
  mode: 'total' | 'stats'
}) {
  const [hover, setHover] = useState<number | null>(null)
  const series = useMemo(
    () =>
      mode === 'total'
        ? [{ key: 'total', label: 'Total', color: TOTAL_COLOR }]
        : STAT_NAMES.map((stat) => ({
            key: stat,
            label: STAT_META[stat].label,
            color: STAT_META[stat].color,
          })),
    [mode],
  )

  if (points.length < 2) {
    return <p className="empty-state">Not enough history to chart yet.</p>
  }

  const values = points.flatMap((point) =>
    series.map((line) => point[line.key as keyof StatPoint]),
  )
  const minY = Math.min(...values) * 0.97
  const maxY = Math.max(...values) * 1.03 || 1
  const minX = points[0].timestamp
  const spanX = points[points.length - 1].timestamp - minX || 1
  const x = (timestamp: number) => ((timestamp - minX) / spanX) * 100
  const y = (value: number) => 100 - ((value - minY) / (maxY - minY || 1)) * 100

  function track(event: PointerEvent<HTMLDivElement>) {
    const rect = event.currentTarget.getBoundingClientRect()
    const target = minX + ((event.clientX - rect.left) / rect.width) * spanX
    let nearest = 0
    for (let index = 1; index < points.length; index++) {
      if (
        Math.abs(points[index].timestamp - target) <
        Math.abs(points[nearest].timestamp - target)
      )
        nearest = index
    }
    setHover(nearest)
  }

  const hovered = hover === null ? null : points[hover]

  return (
    <div className="my-stats-chart">
      <div className="my-stats-axis">
        <span>{formatCompactStat(maxY)}</span>
        <span>{formatCompactStat(minY)}</span>
      </div>
      <div
        className="my-stats-plot"
        onPointerMove={track}
        onPointerLeave={() => setHover(null)}
      >
        <svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden>
          {series.map((line) => (
            <polyline
              key={line.key}
              fill="none"
              stroke={line.color}
              strokeWidth={2}
              vectorEffect="non-scaling-stroke"
              points={points
                .map(
                  (point) =>
                    `${x(point.timestamp)},${y(point[line.key as keyof StatPoint])}`,
                )
                .join(' ')}
            />
          ))}
        </svg>
        {hovered && (
          <>
            <i
              className="my-stats-cursor"
              style={{ left: `${x(hovered.timestamp)}%` }}
            />
            <div
              className="my-stats-tooltip"
              style={
                x(hovered.timestamp) > 60
                  ? { right: `${100 - x(hovered.timestamp)}%` }
                  : { left: `${x(hovered.timestamp)}%` }
              }
            >
              <strong>
                {new Date(hovered.timestamp * 1000).toLocaleDateString()}
              </strong>
              {series.map((line) => (
                <span key={line.key}>
                  <i style={{ background: line.color }} />
                  {line.label}{' '}
                  {formatCompactStat(hovered[line.key as keyof StatPoint])}
                </span>
              ))}
            </div>
          </>
        )}
      </div>
      <div className="my-stats-dates">
        <span>{new Date(minX * 1000).toLocaleDateString()}</span>
        <span>
          {new Date(
            points[points.length - 1].timestamp * 1000,
          ).toLocaleDateString()}
        </span>
      </div>
    </div>
  )
}

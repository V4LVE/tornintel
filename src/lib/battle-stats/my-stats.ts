// The key owner's own battle stats: shared types and pure helpers used by the
// /api/my-stats routes and the My stats page.

import type { FfScouterEstimate } from '#/lib/levelling/levelling'

export const STAT_NAMES = ['strength', 'defense', 'speed', 'dexterity'] as const
export type StatName = (typeof STAT_NAMES)[number]

export type StatModifier = { effect: string; value: number; type: string }

export type BattleStatDetail = {
  value: number
  modifier: number
  modifiers: StatModifier[]
}

export type BattleStats = Record<StatName, BattleStatDetail> & {
  total: number
}

/** A point-in-time reading of the four raw battle stats (timestamp in unix seconds). */
export type StatPoint = Record<StatName, number> & {
  timestamp: number
  total: number
}

export type MyStatsResponse = {
  profile: { id: number; name: string; level: number }
  battlestats: BattleStats
  fetchedAt: number
}

export const STAT_META: Record<
  StatName,
  { label: string; short: string; color: string; blurb: string }
> = {
  strength: {
    label: 'Strength',
    short: 'STR',
    color: '#f38b6e',
    blurb: 'Damage you deal with each hit',
  },
  defense: {
    label: 'Defense',
    short: 'DEF',
    color: '#c1a6e7',
    blurb: 'Damage you mitigate when hit',
  },
  speed: {
    label: 'Speed',
    short: 'SPD',
    color: '#7bdda5',
    blurb: 'Chance your attacks land',
  },
  dexterity: {
    label: 'Dexterity',
    short: 'DEX',
    color: '#78b4dc',
    blurb: 'Chance to evade incoming hits',
  },
}

const HISTORIC_STATS: Record<string, StatName | 'total'> = {
  strength: 'strength',
  defense: 'defense',
  speed: 'speed',
  dexterity: 'dexterity',
  totalstats: 'total',
}
export const HISTORIC_STAT_QUERY = Object.keys(HISTORIC_STATS).join(',')

/**
 * Converts Torn's v2 personalstats list into a StatPoint.
 * Returns null when Torn has no record of all four stats at that time.
 */
export function parsePersonalStats(
  list: { name: string; value: number }[] | undefined,
  timestamp: number,
): StatPoint | null {
  const point: Partial<StatPoint> = { timestamp }
  for (const { name, value } of list ?? []) {
    const field = HISTORIC_STATS[name] as StatName | 'total' | undefined
    if (field && Number.isFinite(value)) point[field] = value
  }
  if (STAT_NAMES.some((stat) => point[stat] === undefined)) return null
  point.total ??= STAT_NAMES.reduce((sum, stat) => sum + point[stat]!, 0)
  return point as StatPoint
}

export function toStatPoint(stats: BattleStats, timestamp: number): StatPoint {
  return {
    timestamp,
    strength: stats.strength.value,
    defense: stats.defense.value,
    speed: stats.speed.value,
    dexterity: stats.dexterity.value,
    total: stats.total,
  }
}

/** Value after passive modifiers (education, faction, company, etc.) are applied. */
export const effectiveValue = (value: number, modifierPercent: number) =>
  Math.round(value * (1 + modifierPercent / 100))

export type BuildProfile = {
  title: string
  description: string
  /** Share of the total in Strength + Speed (the rest is Defense + Dexterity). */
  offenseShare: number
}

/** A light-hearted read on how the stats are distributed. */
export function describeBuild(point: StatPoint): BuildProfile {
  const values = STAT_NAMES.map((stat) => point[stat])
  const max = Math.max(...values)
  const min = Math.min(...values)
  const offense = point.strength + point.speed
  const defense = point.defense + point.dexterity
  const offenseShare =
    offense + defense > 0 ? offense / (offense + defense) : 0.5
  const build = (title: string, description: string) => ({
    title,
    description,
    offenseShare,
  })

  if (point.total === 0)
    return build('Fresh recruit', 'Hit the gym: every legend starts at zero.')
  if (max / Math.max(min, 1) < 1.25)
    return build(
      'Balanced',
      'Even spread across all four stats. Hard to counter, solid all-rounder.',
    )
  if (offense / Math.max(defense, 1) > 1.3)
    return build(
      'Glass cannon',
      'Strength and speed lead the way. You hit hard and land often.',
    )
  if (defense / Math.max(offense, 1) > 1.3)
    return build(
      'Tank',
      'Defense and dexterity dominate. Built to outlast attackers.',
    )

  const top = STAT_META[STAT_NAMES[values.indexOf(max)]].label
  return build(
    `${top} specialist`,
    `${top} is your strongest stat by a clear margin.`,
  )
}

export type RangeKey = '7d' | '30d' | '90d' | '1y'

export const RANGES: Record<
  RangeKey,
  { label: string; days: number; stepDays: number }
> = {
  '7d': { label: '7D', days: 7, stepDays: 1 },
  '30d': { label: '30D', days: 30, stepDays: 1 },
  '90d': { label: '90D', days: 90, stepDays: 3 },
  '1y': { label: '1Y', days: 364, stepDays: 7 },
}

const DAY = 86_400

/** The last second of the UTC (Torn City Time) day containing the timestamp. */
export const dayEnd = (timestamp: number) =>
  Math.floor(timestamp / DAY) * DAY + DAY - 1

/**
 * Sample timestamps for a range, at the end of each UTC (Torn City Time) day,
 * so the same days are reused from cache across ranges and visits.
 */
export function sampleTimestamps(
  range: RangeKey,
  now = Date.now() / 1000,
): number[] {
  const { days, stepDays } = RANGES[range]
  const today = Math.floor(now / DAY) * DAY
  const result: number[] = []
  for (let offset = days; offset > 0; offset -= stepDays) {
    result.push(today - offset * DAY + DAY - 1)
  }
  return result
}

export type FactionStatsMember = {
  id: string
  name: string
  level: number
  estimate: FfScouterEstimate | null
  /** Present only when the member has opted in to share their real stats. */
  shared: {
    current: StatPoint
    history: StatPoint[]
    /** Milliseconds. */
    updatedAt: number
  } | null
}

export type FactionStatsResponse = {
  faction: { id: string; name: string }
  viewer: { id: string; isSharing: boolean }
  members: FactionStatsMember[]
  ffScouterReason?: string
  sharingReason?: string
}

const compact = new Intl.NumberFormat('en-US', {
  notation: 'compact',
  maximumFractionDigits: 2,
})

export const formatCompactStat = (value: number) => compact.format(value)

export function formatSignedStat(value: number) {
  return `${value < 0 ? '−' : '+'}${compact.format(Math.abs(value))}`
}

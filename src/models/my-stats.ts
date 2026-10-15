// My stats: the key owner's own battle stats, their history and sharing them
// with the faction.

import type { FfScouterEstimate } from '#/models/ffscouter'

export type StatName = 'strength' | 'defense' | 'speed' | 'dexterity'

export type StatModifier = { effect: string; value: number; type: string }

export type BattleStatDetail = {
  value: number
  modifier: number
  modifiers: StatModifier[]
}

// Torn's v2 battlestats for the key owner, with passive modifiers. Not the
// estimate-side BattleStats in battle-stats.ts.
export type OwnBattleStats = Record<StatName, BattleStatDetail> & {
  total: number
}

// A point-in-time reading of the four raw stats (timestamp in unix seconds).
export type StatPoint = Record<StatName, number> & {
  timestamp: number
  total: number
}

// A reading with when Torn observed it (unix seconds), used to order readings
// within one day.
export type ObservedStatPoint = StatPoint & { observedAt: number }

export type RangeKey = '7d' | '30d' | '90d' | '1y'

// Who owns a key, always read from Torn.
export type PlayerIdentity = {
  id: string
  name: string
  // Null when the player is not in a faction.
  factionId: string | null
  factionName: string | null
}

// GET /api/my-stats
export type MyStatsResponse = {
  profile: { id: number; name: string; level: number }
  battlestats: OwnBattleStats
  // Milliseconds.
  fetchedAt: number
}

// GET /api/my-stats-history; null when Torn has no record at that time.
export type StatHistoryResponse = { point: StatPoint | null }

// GET and POST /api/stat-sharing; GET also names the viewer's faction.
export type StatSharingResponse = {
  isSharing: boolean
  factionName?: string | null
}

export type FactionStatsMember = {
  id: string
  name: string
  level: number
  estimate: FfScouterEstimate | null
  // Present only when the member opted in to share their real stats.
  shared: {
    current: StatPoint
    history: StatPoint[]
    // Milliseconds.
    updatedAt: number
  } | null
}

// GET /api/faction-stats
export type FactionStatsResponse = {
  faction: { id: string; name: string }
  viewer: { id: string; isSharing: boolean }
  members: FactionStatsMember[]
  ffScouterReason?: string
  sharingReason?: string
}

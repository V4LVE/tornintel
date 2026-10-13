// Levelling list players, tiers and the /api/levelling-* responses.

import type {
  BattleStatContributor,
  BattleStatsEstimate,
} from '#/models/battle-stats'
import type { FfScouterEstimate } from '#/models/ffscouter'

export type LevellingTier =
  | 'tier1'
  | 'tier2'
  | 'tier3'
  | 'tier4'
  | 'tier5'
  | 'tier6'
  | 'tier7'
  | 'tier8'
  | 'tier9'
  | 'tier10'

// Bundled player entries keep the spreadsheet format: numbers may be strings with commas.
export type RawListPlayer = {
  name: string
  id: string
  lvl: string | number
  total?: string | number
  str?: string | number
  def?: string | number
  spd?: string | number
  dex?: string | number
}

export type LevellingPlayer = {
  id: number
  name: string
  level: number
  // Recorded on the list. Players added in tornintel only have FF Scouter's
  // total estimate from when they were added, without a stat breakdown.
  total: number
  str: number | null
  def: number | null
  spd: number | null
  dex: number | null
  addedBy?: { id: number; name: string }
}

// A stored change to the shared list: an added player, or a removed one.
export type LevellingListChange = {
  playerId: number
  name: string
  level: number
  totalEstimate: number | null
  removed: boolean
  addedById: number | null
  addedByName: string | null
}

export type LevellingListResponse = {
  players: LevellingPlayer[]
  // True when the viewer's key belongs to a trusted editor who may remove players.
  canEdit?: boolean
  warning?: string
  error?: string
}

export type LevellingEstimatesResponse = {
  estimates: Record<string, FfScouterEstimate | null>
  error?: string
}

export type DiscoveredPlayer = {
  id: number
  name: string
  level: number
  lastActionAt: number | null
  estimate: FfScouterEstimate | null
  onList: boolean
}

// Fair Fight based estimates, as on the war hospital target list. Only players
// with recorded evidence are included.
export type LevellingStatsResponse = {
  stats: Record<
    string,
    { battleStats: BattleStatsEstimate; contributors: BattleStatContributor[] }
  >
  fairFightReason?: string
  sharedTbsReason?: string
  error?: string
}

export type LevellingDiscoverResponse = {
  players: DiscoveredPlayer[]
  error?: string
}

export type LevellingTarget = LevellingPlayer & {
  // Level and status confirmed by Torn when the target was picked.
  currentLevel: number
  status: string
}

export type LevellingTargetsResponse = {
  targets: LevellingTarget[]
  poolSize: number
  checked: number
  skipped: { id: number; name: string; reason: string }[]
  fetchedAt: number
  message?: string
  error?: string
}

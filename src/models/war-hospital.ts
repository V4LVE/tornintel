// War hospital members, combat bars and the keep-alive chain target.

import type {
  BattleStatContributor,
  BattleStatsEstimate,
} from '#/models/battle-stats'
import type { TornBar, TornChain } from '#/models/torn'
import type { TravelEstimate } from '#/models/travel'

export type EnemyFactionSource =
  'manual' | 'current-war' | 'last-war' | 'default'

export type EnemyFaction = { id: string; source: EnemyFactionSource }

export type ChainTarget = {
  id: number
  name: string
  level: number
  lastWonAt: number
}

export type ChainTargetResponse = {
  target: ChainTarget | null
  fetchedAt: number
  message?: string
  error?: string
}

export type WarTarget = {
  id: string
  name: string
  level: number
  status: 'Ready' | 'In hospital' | 'Traveling' | 'Abroad' | 'Unavailable'
  detail: string
  releaseAt: number
  reason: string
  lastSeen: string
  hospitalRecommended: boolean
  priority: 'High' | 'Medium' | 'Low'
  battleStats: BattleStatsEstimate
  battleStatContributors: BattleStatContributor[]
  travel: TravelEstimate | null
}

export type FactionMembersResponse = {
  faction: { id: number; name: string; tag: string; source: EnemyFactionSource }
  members: WarTarget[]
  fairFightStatus: 'READY' | 'NO_RECENT_FIGHTS' | 'UNAVAILABLE'
  fairFightReason?: string
  sharedTbsStatus: 'READY' | 'UNAVAILABLE'
  sharedTbsReason?: string
  travelTrackingReason?: string
  statusObservedAt: number
  fetchedAt: number
  error?: string
}

export type CombatBarsResponse = {
  energy?: TornBar
  chain?: TornChain | null
  fetchedAt?: number
  error?: string
}

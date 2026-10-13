// Raw Torn API response shapes, as tornintel reads them.

import type { MemberStatus } from '#/models/travel'

// A v1 user profile; levelling routes read the editor's faction and target status.
export type TornBasicProfile = {
  player_id?: number
  name?: string
  level?: number
  status?: { state?: string; description?: string }
  faction?: { faction_id?: number }
}

export type TornBattleStat = number | string | { value?: number | string }

export type TornAttack = {
  id?: number | string
  attacker_id?: number
  defender_id?: number
  timestamp_ended?: number
  timestamp_started?: number
  modifiers?: { fair_fight?: number; group_attack?: number }
  result?: string
  is_interrupted?: boolean
}

export type TornCombatResponse = {
  player_id?: number
  name?: string
  // API v1 merges selections into the top-level response. API v2 nests them.
  strength?: TornBattleStat
  speed?: TornBattleStat
  defense?: TornBattleStat
  dexterity?: TornBattleStat
  battlestats?: {
    strength?: TornBattleStat
    speed?: TornBattleStat
    defense?: TornBattleStat
    dexterity?: TornBattleStat
  }
  attacks?: Record<string, TornAttack> | TornAttack[]
  error?: { error: string; code: number }
}

export type TornUserResponse = {
  player_id?: number
  name?: string
  level?: number
  faction?: { faction_id?: number; faction_name?: string }
  error?: { error: string; code: number }
}

export type TornFactionMember = {
  name: string
  level: number
  last_action?: { relative?: string | number; status?: string }
  status: MemberStatus
}

export type TornFactionResponse = {
  ID: number
  name: string
  tag: string
  members?: Record<string, TornFactionMember>
  error?: { error: string; code: number }
}

export type TornBar = {
  current: number
  maximum: number
  increment: number
  interval: number
  tick_time: number
  full_time: number
}

export type TornChain = {
  current: number
  max: number
  timeout: number
  cooldown: number
}

export type TornBarsResponse = {
  bars?: { energy?: TornBar; chain?: TornChain | null }
  error?: { code: number; error: string }
}

export type TornAttacksProfile = {
  player_id?: number
  name?: string
  level?: number
  status?: { state?: string }
  faction?: { faction_id?: number }
  attacks?: Record<string, TornAttack> | TornAttack[]
  error?: { error: string }
}

export type TornFactionAttack = {
  attacker?: { id?: number; name?: string }
  is_ranked_war?: boolean
}

export type TornRankedWarMembersReport = {
  rankedwarreport?: {
    start?: number
    end?: number
    factions?: Array<{
      id?: number
      members?: Record<string, { name?: string; attacks?: number }>
    }>
  }
}

export type TornFaction = { id: number; name: string }

export type TornRankedWar = {
  id: number
  end: number
  start: number
  target: number
  factions: TornFaction[]
}

export type TornItem = {
  id: number
  name: string
  value: { market_price: number }
}

export type TornRankedWarReport = {
  rankedwarreport: {
    id: number
    end: number
    winner: number
    factions: Array<
      TornFaction & {
        rewards: {
          items: Array<{ id: number; name: string; quantity: number }>
        }
      }
    >
  }
}

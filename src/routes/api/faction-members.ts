import { createFileRoute } from '@tanstack/react-router'
import {
  calculateBalanceFactor,
  calculateBattleStatScore,
  estimateBattleStats,
} from '#/lib/battle-stats/estimator'
import type {
  BattleStats,
  FairFightObservation,
} from '#/lib/battle-stats/estimator'

type TornMember = {
  name: string
  level: number
  last_action?: { relative?: string; status?: string }
  status: {
    description?: string
    details?: string
    state?: string
    until?: number
  }
}

type TornFactionResponse = {
  ID: number
  name: string
  tag: string
  members?: Record<string, TornMember>
  error?: { error: string; code: number }
}

type TornBattleStat = number | string | { value?: number | string }

type TornAttack = {
  attacker_id?: number
  defender_id?: number
  timestamp_ended?: number
  timestamp_started?: number
  modifiers?: { fair_fight?: number }
  result?: string
  is_interrupted?: boolean
}

type TornCombatResponse = {
  player_id?: number
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
type FairFightLoad = {
  observations: Map<string, FairFightObservation[]>
  status: 'READY' | 'NO_RECENT_FIGHTS' | 'UNAVAILABLE'
  reason?: string
}
const THIRTY_MINUTES = 30 * 60 * 1000
const CURRENT_PLAYER_STATS_WINDOW = 14 * 24 * 60 * 60 * 1000

export const Route = createFileRoute('/api/faction-members')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const apiKey = request.headers.get('x-torn-api-key')?.trim()
        const requestedFactionId = new URL(request.url).searchParams.get(
          'factionId',
        )
        const factionId =
          requestedFactionId || process.env.TORN_ENEMY_FACTION_ID || '56833'

        if (!/^\d{1,10}$/.test(factionId)) {
          console.warn('[tornintel] Rejected invalid faction ID', {
            factionId: requestedFactionId,
          })
          return Response.json(
            { error: 'Faction ID must contain digits only.' },
            { status: 400 },
          )
        }

        if (!apiKey) {
          return Response.json(
            { error: 'Enter your Torn API key to begin tracking.' },
            { status: 401 },
          )
        }

        const url = new URL(`https://api.torn.com/faction/${factionId}`)
        url.searchParams.set('selections', '')
        url.searchParams.set('key', apiKey)

        try {
          const response = await fetch(url, { cache: 'no-store' })
          if (!response.ok) {
            throw new Error(`Torn returned HTTP ${response.status}`)
          }

          const faction = (await response.json()) as TornFactionResponse
          if (faction.error) {
            console.error('[tornintel] Torn rejected faction request', {
              factionId,
              code: faction.error.code,
              message: faction.error.error,
            })
            return Response.json(
              { error: faction.error.error },
              { status: 502 },
            )
          }

          const now = Date.now()
          const fairFightEvidence = await loadFairFightEvidence(apiKey, now)
          const members = Object.entries(faction.members ?? {})
            .map(([id, member]) =>
              formatMember(
                id,
                member,
                now,
                fairFightEvidence.observations.get(id) ?? [],
              ),
            )
            .sort((left, right) => {
              const statusOrder = { Ready: 0, 'In hospital': 1, Traveling: 2 }
              const orderDifference =
                statusOrder[left.status] - statusOrder[right.status]

              return orderDifference || left.releaseAt - right.releaseAt
            })

          return Response.json(
            {
              faction: { id: faction.ID, name: faction.name, tag: faction.tag },
              members,
              fairFightStatus: fairFightEvidence.status,
              fairFightReason: fairFightEvidence.reason,
              fetchedAt: now,
            },
            { headers: { 'Cache-Control': 'no-store' } },
          )
        } catch (error) {
          console.error('[tornintel] Faction fetch failed', {
            factionId,
            message: error instanceof Error ? error.message : String(error),
          })
          return Response.json(
            {
              error: 'Unable to reach Torn right now. Try refreshing shortly.',
            },
            { status: 502 },
          )
        }
      },
    },
  },
})

function formatMember(
  id: string,
  member: TornMember,
  now: number,
  fairFightObservations: FairFightObservation[],
) {
  const state = member.status.state ?? 'Unknown'
  const releaseAt = (member.status.until ?? 0) * 1000
  const status =
    state === 'Hospital'
      ? 'In hospital'
      : state === 'Okay'
        ? 'Ready'
        : 'Traveling'
  const remaining = releaseAt - now

  return {
    id,
    name: member.name,
    level: member.level,
    status,
    detail: member.status.description ?? state,
    releaseAt: status === 'In hospital' ? releaseAt : now,
    reason:
      stripHtml(member.status.details) || member.status.description || state,
    lastSeen:
      member.last_action?.relative ?? member.last_action?.status ?? 'Unknown',
    priority:
      status === 'Ready'
        ? 'High'
        : status === 'In hospital' && remaining <= THIRTY_MINUTES
          ? 'High'
          : status === 'In hospital'
            ? 'Medium'
            : 'Low',
    battleStats: estimateBattleStats({
      now,
      fairFightObservations,
    }),
  } as const
}

async function loadFairFightEvidence(
  apiKey: string,
  now: number,
): Promise<FairFightLoad> {
  // v1 is intentionally used here because the application already uses it and
  // it lets a limited key request its own stats and detailed attacks together.
  const url = new URL('https://api.torn.com/user/')
  url.searchParams.set('selections', 'profile,battlestats,attacks')
  url.searchParams.set('key', apiKey)

  try {
    const response = await fetch(url, { cache: 'no-store' })
    if (!response.ok)
      return emptyFairFightEvidence(`Torn returned HTTP ${response.status}.`)
    const combat = (await response.json()) as TornCombatResponse
    if (combat.error)
      return emptyFairFightEvidence(
        `Torn rejected the combat request (${combat.error.code}: ${combat.error.error}).`,
      )
    if (!combat.player_id)
      return emptyFairFightEvidence('Torn did not return your player ID.')

    const stats = parseBattleStats(combat)
    if (!stats)
      return emptyFairFightEvidence(
        'Torn did not return readable battle stats.',
      )
    const attackerBss = calculateBattleStatScore(stats)
    const attackerBalanceFactor = calculateBalanceFactor(stats)
    const attacks = Array.isArray(combat.attacks)
      ? combat.attacks
      : Object.values(combat.attacks ?? {})
    const observations = new Map<string, FairFightObservation[]>()
    for (const attack of attacks) {
      if (
        attack.is_interrupted ||
        (attack.result &&
          !['Hospitalized', 'Mugged', 'Attacked', 'Left'].includes(
            attack.result,
          ))
      )
        continue
      const outgoing = attack.attacker_id === combat.player_id
      const incoming = attack.defender_id === combat.player_id
      if (!outgoing && !incoming) continue
      const targetId = outgoing ? attack.defender_id : attack.attacker_id
      const fairFight = attack.modifiers?.fair_fight
      const timestamp =
        (attack.timestamp_ended ?? attack.timestamp_started ?? now / 1000) *
        1000
      // We only know the signed-in player's current stats, so do not use
      // older fights as if those stats were known at the time.
      if (timestamp < now - CURRENT_PLAYER_STATS_WINDOW) continue
      if (!targetId || !fairFight) continue
      const targetObservations = observations.get(String(targetId)) ?? []
      targetObservations.push({
        targetId: String(targetId),
        attackerId: String(attack.attacker_id ?? 'self'),
        attackerBss,
        ...(incoming ? { defenderBss: attackerBss } : {}),
        attackerBalanceFactor,
        fairFight,
        timestamp,
        attackerStatsExact: false,
      })
      observations.set(String(targetId), targetObservations)
    }
    return {
      observations,
      status: observations.size ? 'READY' : 'NO_RECENT_FIGHTS',
    }
  } catch (error) {
    console.warn('[tornintel] Could not load optional Fair Fight evidence', {
      message: error instanceof Error ? error.message : String(error),
    })
    return emptyFairFightEvidence(
      'The combat request failed. Try syncing again.',
    )
  }
}

function emptyFairFightEvidence(reason: string): FairFightLoad {
  return { observations: new Map(), status: 'UNAVAILABLE', reason }
}

function parseBattleStats(combat: TornCombatResponse): BattleStats | null {
  const source = combat.battlestats ?? combat
  const value = (stat: TornBattleStat | undefined) => {
    const raw = typeof stat === 'object' ? stat.value : stat
    if (typeof raw === 'number') return raw
    if (typeof raw === 'string' && /^[\d,]+(?:\.\d+)?$/.test(raw))
      return Number(raw.replaceAll(',', ''))
    return null
  }
  const strength = value(source.strength)
  const speed = value(source.speed)
  const defense = value(source.defense)
  const dexterity = value(source.dexterity)
  if (
    strength === null ||
    speed === null ||
    defense === null ||
    dexterity === null ||
    ![strength, speed, defense, dexterity].every(
      (stat) => Number.isFinite(stat) && stat >= 0,
    )
  ) {
    return null
  }
  return { strength, speed, defense, dexterity }
}

function stripHtml(value?: string) {
  return (
    value
      ?.replace(/<[^>]*>/g, '')
      .replace(/\s+/g, ' ')
      .trim() ?? ''
  )
}

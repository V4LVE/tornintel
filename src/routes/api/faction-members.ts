import { createFileRoute } from '@tanstack/react-router'
import {
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

type TornBattleStat = number | { value?: number }

type TornAttack = {
  attacker_id?: number
  defender_id?: number
  timestamp_ended?: number
  timestamp_started?: number
  modifiers?: { fair_fight?: number }
}

type TornCombatResponse = {
  player_id?: number
  battlestats?: {
    strength?: TornBattleStat
    speed?: TornBattleStat
    defense?: TornBattleStat
    dexterity?: TornBattleStat
  }
  attacks?: Record<string, TornAttack> | TornAttack[]
  error?: { error: string; code: number }
}
const THIRTY_MINUTES = 30 * 60 * 1000
const CURRENT_ATTACKER_STATS_WINDOW = 14 * 24 * 60 * 60 * 1000
const PROFILE_CACHE_TTL = 6 * 60 * 60 * 1000
const PROFILE_LOOKUPS_PER_REFRESH = 10
const profileAgeCache = new Map<string, { age: number; fetchedAt: number }>()
const medalCountCache = new Map<string, { count: number; fetchedAt: number }>()

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
          const fairFightByTarget = await loadFairFightEvidence(apiKey, now)
          const ages = await loadProfileAges(
            Object.keys(faction.members ?? {}),
            apiKey,
            now,
          )
          const medalCounts = await loadMedalCounts(
            Object.keys(faction.members ?? {}),
            apiKey,
            now,
          )
          const members = Object.entries(faction.members ?? {})
            .map(([id, member]) =>
              formatMember(
                id,
                member,
                now,
                fairFightByTarget.get(id) ?? [],
                ages.get(id),
                medalCounts.get(id),
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
  age?: number,
  medals?: number,
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
      weakMetadata: { age, level: member.level, medals },
    }),
  } as const
}

async function loadProfileAges(ids: string[], apiKey: string, now: number) {
  const missing = ids.filter((id) => {
    const cached = profileAgeCache.get(id)
    return !cached || now - cached.fetchedAt > PROFILE_CACHE_TTL
  })
  await Promise.all(
    missing.slice(0, PROFILE_LOOKUPS_PER_REFRESH).map(async (id) => {
      const url = new URL(`https://api.torn.com/v2/user/${id}/profile`)
      url.searchParams.set('key', apiKey)
      try {
        const response = await fetch(url, { cache: 'no-store' })
        if (!response.ok) return
        const payload = (await response.json()) as {
          profile?: { age?: number }
          age?: number
        }
        const age = payload.profile?.age ?? payload.age
        if (typeof age === 'number' && age > 0) {
          profileAgeCache.set(id, { age, fetchedAt: now })
        }
      } catch {
        // Profile enrichment is optional and must not interrupt hospital data.
      }
    }),
  )
  return new Map(
    ids.flatMap((id) => {
      const cached = profileAgeCache.get(id)
      return cached ? [[id, cached.age] as const] : []
    }),
  )
}

async function loadMedalCounts(ids: string[], apiKey: string, now: number) {
  const missing = ids.filter((id) => {
    const cached = medalCountCache.get(id)
    return !cached || now - cached.fetchedAt > PROFILE_CACHE_TTL
  })
  await Promise.all(
    missing.slice(0, PROFILE_LOOKUPS_PER_REFRESH).map(async (id) => {
      const url = new URL(`https://api.torn.com/v2/user/${id}/medals`)
      url.searchParams.set('key', apiKey)
      try {
        const response = await fetch(url, { cache: 'no-store' })
        if (!response.ok) return
        const payload = (await response.json()) as { medals?: unknown[] }
        if (Array.isArray(payload.medals)) {
          medalCountCache.set(id, {
            count: payload.medals.length,
            fetchedAt: now,
          })
        }
      } catch {
        // Medal enrichment is optional and must not interrupt hospital data.
      }
    }),
  )
  return new Map(
    ids.flatMap((id) => {
      const cached = medalCountCache.get(id)
      return cached ? [[id, cached.count] as const] : []
    }),
  )
}

async function loadFairFightEvidence(apiKey: string, now: number) {
  // v1 is intentionally used here because the application already uses it and
  // it lets a limited key request its own stats and detailed attacks together.
  const url = new URL('https://api.torn.com/user/')
  url.searchParams.set('selections', 'profile,battlestats,attacks')
  url.searchParams.set('key', apiKey)

  try {
    const response = await fetch(url, { cache: 'no-store' })
    if (!response.ok) return new Map<string, FairFightObservation[]>()
    const combat = (await response.json()) as TornCombatResponse
    if (combat.error) return new Map<string, FairFightObservation[]>()
    if (!combat.player_id) return new Map<string, FairFightObservation[]>()

    const stats = parseBattleStats(combat.battlestats)
    if (!stats) return new Map<string, FairFightObservation[]>()
    const attackerBss = calculateBattleStatScore(stats)
    const attacks = Array.isArray(combat.attacks)
      ? combat.attacks
      : Object.values(combat.attacks ?? {})
    const observations = new Map<string, FairFightObservation[]>()
    for (const attack of attacks) {
      // The user's attack history can include incoming fights. Its own current
      // stats only describe the attacker in outgoing fights.
      if (attack.attacker_id !== combat.player_id) continue
      const targetId = attack.defender_id
      const fairFight = attack.modifiers?.fair_fight
      const timestamp =
        (attack.timestamp_ended ?? attack.timestamp_started ?? now / 1000) *
        1000
      // We only know the attacker's current stats, so do not reinterpret old
      // fights as though those stats were known at the time of the attack.
      if (timestamp < now - CURRENT_ATTACKER_STATS_WINDOW) continue
      if (!targetId || !fairFight) continue
      const targetObservations = observations.get(String(targetId)) ?? []
      targetObservations.push({
        targetId: String(targetId),
        attackerId: String(attack.attacker_id ?? 'self'),
        attackerBss,
        fairFight,
        timestamp,
        attackerStatsExact: false,
      })
      observations.set(String(targetId), targetObservations)
    }
    return observations
  } catch (error) {
    console.warn('[tornintel] Could not load optional Fair Fight evidence', {
      message: error instanceof Error ? error.message : String(error),
    })
    return new Map<string, FairFightObservation[]>()
  }
}

function parseBattleStats(
  battlestats: TornCombatResponse['battlestats'],
): BattleStats | null {
  if (!battlestats) return null
  const value = (stat: TornBattleStat | undefined) =>
    typeof stat === 'number' ? stat : stat?.value
  const strength = value(battlestats.strength)
  const speed = value(battlestats.speed)
  const defense = value(battlestats.defense)
  const dexterity = value(battlestats.dexterity)
  if (
    typeof strength !== 'number' ||
    typeof speed !== 'number' ||
    typeof defense !== 'number' ||
    typeof dexterity !== 'number'
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

import { fetchTorn, TornApiError } from '#/lib/torn/torn-api.server'
import { calculateBalanceFactor, calculateBattleStatScore } from './estimator'
import type {
  BattleStats,
  FairFightLoad,
  FairFightObservation,
  SharedObservation,
} from '#/models/battle-stats'
import type { TornBattleStat, TornCombatResponse } from '#/models/torn'

const CURRENT_PLAYER_STATS_WINDOW = 14 * 24 * 60 * 60 * 1000

export async function loadFairFightEvidence(
  apiKey: string,
  now: number,
): Promise<FairFightLoad> {
  // v1 is intentionally used here because the application already uses it and
  // it lets a limited key request its own stats and detailed attacks together.
  const url = new URL('https://api.torn.com/user/')
  url.searchParams.set('selections', 'profile,battlestats,attacks')
  url.searchParams.set('key', apiKey)

  try {
    const { data: combat } = await fetchTorn<TornCombatResponse>(url, {
      maxAgeMs: 120000,
    })
    if (!combat.player_id)
      return emptyFairFightEvidence('Torn did not return your player ID.')

    const stats = parseBattleStats(combat)
    if (!stats)
      return emptyFairFightEvidence(
        'Torn did not return readable battle stats.',
      )
    const attackerBss = calculateBattleStatScore(stats)
    const attackerBalanceFactor = calculateBalanceFactor(stats)
    const attacks = Object.entries(combat.attacks ?? {})
    const evidence: SharedObservation[] = []
    const observations = new Map<string, FairFightObservation[]>()
    for (const [entryId, attack] of attacks) {
      if (
        attack.is_interrupted ||
        (attack.modifiers?.group_attack ?? 1) > 1 ||
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
        (attack.timestamp_ended ?? attack.timestamp_started ?? 0) * 1000
      // We only know the signed-in player's current stats, so do not use
      // older fights as if those stats were known at the time.
      if (
        !Number.isFinite(timestamp) ||
        timestamp < now - CURRENT_PLAYER_STATS_WINDOW ||
        timestamp > now
      )
        continue
      if (
        !targetId ||
        !fairFight ||
        !Number.isFinite(fairFight) ||
        fairFight < 1 ||
        fairFight > 3 ||
        attackerBss <= 0
      )
        continue
      const targetObservations = observations.get(String(targetId)) ?? []
      const observation: FairFightObservation = {
        targetId: String(targetId),
        attackerId: String(attack.attacker_id ?? 'self'),
        attackerBss,
        ...(incoming ? { defenderBss: attackerBss } : {}),
        attackerBalanceFactor,
        fairFight,
        timestamp,
        attackerStatsExact: false,
      }
      targetObservations.push(observation)
      const attackId =
        attack.id ??
        (Array.isArray(combat.attacks)
          ? `${attack.attacker_id}:${attack.defender_id}:${timestamp}`
          : entryId)
      evidence.push({
        evidenceId: `${combat.player_id}:${attackId}`,
        playerId: String(targetId),
        sourcePlayerId: String(combat.player_id),
        sourcePlayerName: combat.name?.trim() || null,
        observation,
      })
      observations.set(String(targetId), targetObservations)
    }
    return {
      observations,
      evidence,
      status: observations.size ? 'READY' : 'NO_RECENT_FIGHTS',
    }
  } catch (error) {
    console.warn('[tornintel] Could not load optional Fair Fight evidence', {
      message: error instanceof Error ? error.message : String(error),
    })
    return emptyFairFightEvidence(
      error instanceof TornApiError
        ? `Torn rejected the combat request (${error.code ?? 'HTTP'}: ${error.message}).`
        : 'The combat request failed. Try syncing again.',
    )
  }
}

function emptyFairFightEvidence(reason: string): FairFightLoad {
  return {
    observations: new Map(),
    evidence: [],
    status: 'UNAVAILABLE',
    reason,
  }
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

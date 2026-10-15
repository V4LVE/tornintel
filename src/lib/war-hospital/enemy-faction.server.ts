import { fetchTorn, TornApiError } from '../torn/torn-api.server'
import type { TornFaction, TornRankedWar } from '#/models/torn'
import type { EnemyFaction } from '#/models/war-hospital'

// Torn codes for an incorrect, disabled, paused or jailed key.
const KEY_ERRORS = new Set([2, 10, 13, 18])

// Picks the faction to track when the viewer has not chosen one: the opponent in
// their faction's current (or upcoming) ranked war, then the latest finished one,
// then the server default. Lookups failing (e.g. no faction) fall through.
export async function resolveEnemyFaction(
  apiKey: string,
  signal?: AbortSignal,
): Promise<EnemyFaction | null> {
  const get = async <T>(path: string) => {
    const url = new URL(`https://api.torn.com/v2${path}`)
    url.searchParams.set('key', apiKey)
    const { data } = await fetchTorn<T>(url, { maxAgeMs: 60000, signal })
    return data
  }
  try {
    const { basic } = await get<{ basic?: TornFaction }>('/faction/basic')
    if (basic?.id) {
      const opponent = (war?: { factions?: TornFaction[] } | null) =>
        war?.factions?.find((faction) => faction.id !== basic.id)

      const { wars } = await get<{ wars?: { ranked?: TornRankedWar | null } }>(
        '/faction/wars',
      )
      const current = opponent(wars?.ranked)
      if (current) return { id: String(current.id), source: 'current-war' }

      const { rankedwars } = await get<{ rankedwars?: TornRankedWar[] }>(
        '/faction/rankedwars?limit=5&sort=DESC',
      )
      const latest = (rankedwars ?? [])
        .filter((war) => war.end > 0)
        .sort((a, b) => b.end - a.end)[0]
      const last = opponent(latest)
      if (last) return { id: String(last.id), source: 'last-war' }
    }
  } catch (error) {
    // A broken key should be reported, not hidden behind the default faction.
    if (
      signal?.aborted ||
      (error instanceof TornApiError && KEY_ERRORS.has(error.code ?? 0))
    )
      throw error
  }
  const fallback = process.env.TORN_ENEMY_FACTION_ID?.trim()
  return fallback && /^\d{1,10}$/.test(fallback)
    ? { id: fallback, source: 'default' }
    : null
}

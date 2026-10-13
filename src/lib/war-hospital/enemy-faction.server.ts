import { fetchTorn, TornApiError } from '../torn/torn-api.server'

// Torn codes for an incorrect, disabled, paused or jailed key.
const KEY_ERRORS = new Set([2, 10, 13, 18])

type Faction = { id: number; name: string }
type RankedWar = { id: number; start: number; end: number; factions: Faction[] }

export type EnemyFactionSource =
  'manual' | 'current-war' | 'last-war' | 'default'

export type EnemyFaction = { id: string; source: EnemyFactionSource }

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
    const { basic } = await get<{ basic?: Faction }>('/faction/basic')
    if (basic?.id) {
      const opponent = (war?: { factions?: Faction[] } | null) =>
        war?.factions?.find((faction) => faction.id !== basic.id)

      const { wars } = await get<{ wars?: { ranked?: RankedWar | null } }>(
        '/faction/wars',
      )
      const current = opponent(wars?.ranked)
      if (current) return { id: String(current.id), source: 'current-war' }

      const { rankedwars } = await get<{ rankedwars?: RankedWar[] }>(
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

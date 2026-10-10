import { fetchTorn } from './torn-api.server'
import type { DealDefaults } from './war-deal-data'

type Faction = { id: number; name: string }
type RankedWar = {
  id: number
  end: number
  start: number
  target: number
  factions: Faction[]
}
type Item = { id: number; name: string; value: { market_price: number } }
type Report = {
  rankedwarreport: {
    id: number
    end: number
    winner: number
    factions: Array<
      Faction & {
        rewards: {
          items: Array<{ id: number; name: string; quantity: number }>
        }
      }
    >
  }
}

export async function loadDealDefaults(
  key: string,
  opponentId?: number,
): Promise<DealDefaults> {
  const get = async <T>(path: string, maxAgeMs = 60000): Promise<T> => {
    const url = new URL(`https://api.torn.com/v2${path}`)
    url.searchParams.set('key', key)
    const { data } = await fetchTorn<T>(url, { maxAgeMs })
    return data
  }
  const { basic } = await get<{ basic?: Faction }>('/faction/basic')
  if (!basic?.id || !basic.name)
    throw new Error('Could not identify your faction.')
  const warnings: string[] = []
  const optional = async <T>(
    label: string,
    operation: Promise<T>,
  ): Promise<T | null> => {
    try {
      return await operation
    } catch (error) {
      warnings.push(
        `${label}: ${error instanceof Error ? error.message : 'unavailable'}`,
      )
      return null
    }
  }
  const [wars, catalog] = await Promise.all([
    optional(
      'Current war unavailable',
      get<{
        wars: {
          ranked: {
            war_id: number
            target: number
            start: number
            factions: Faction[]
          } | null
        }
      }>('/faction/wars'),
    ),
    optional(
      'Item prices unavailable',
      get<{ items: Item[] }>('/torn/items', 300000),
    ),
  ])
  const current = wars?.wars.ranked
  let opponent =
    current?.factions.find((faction) => faction.id !== basic.id) ?? null
  if (opponentId && opponentId !== opponent?.id) {
    if (opponentId === basic.id)
      throw new Error('The opponent must be a different faction.')
    const other = await optional(
      'Opponent unavailable',
      get<{ basic: Faction }>(`/faction/${opponentId}/basic`),
    )
    opponent = other?.basic ?? null
  }
  const items = (catalog?.items ?? [])
    .filter((item) => Number.isFinite(item.value.market_price))
    .map((item) => ({
      id: item.id,
      name: item.name,
      price: item.value.market_price,
    }))
  const cacheNames = [
    'Armor Cache',
    'Melee Cache',
    'Small Arms Cache',
    'Medium Arms Cache',
    'Heavy Arms Cache',
  ]
  const caches = cacheNames.map((name) => ({
    name: name.replace(' Cache', ''),
    ours: 0,
    theirs: 0,
    price:
      items.find((item) => item.name.toLowerCase() === name.toLowerCase())
        ?.price ?? 0,
  }))
  const baselines: DealDefaults['baselines'] = []
  await Promise.all(
    [basic, opponent].map(async (faction, index) => {
      if (!faction) return
      const history = await optional(
        `${faction.name} reward history unavailable`,
        get<{ rankedwars: RankedWar[] }>(
          `/faction/${faction.id}/rankedwars?limit=5&sort=DESC`,
        ),
      )
      const latest = history?.rankedwars
        .filter((war) => war.end > 0)
        .sort((a, b) => b.end - a.end)[0]
      if (!latest) {
        warnings.push(
          `No completed war found for ${faction.name}; enter their cache estimate manually.`,
        )
        return
      }
      const report = await optional(
        `${faction.name} reward report unavailable`,
        get<Report>(`/faction/${latest.id}/rankedwarreport`, 300000),
      )
      const rewards = report?.rankedwarreport.factions.find(
        (side) => side.id === faction.id,
      )?.rewards.items
      if (!report || !rewards) return
      for (const cache of caches) {
        const item = rewards.find(
          (reward) =>
            reward.name.toLowerCase() === `${cache.name} Cache`.toLowerCase(),
        )
        cache[index === 0 ? 'ours' : 'theirs'] = item?.quantity ?? 0
      }
      baselines.push({
        factionName: faction.name,
        warId: latest.id,
        won: report.rankedwarreport.winner === faction.id,
        end: report.rankedwarreport.end,
      })
    }),
  )
  return {
    ourFaction: basic,
    theirFaction: opponent,
    war:
      current && current.factions.some((faction) => faction.id === opponent?.id)
        ? { id: current.war_id, target: current.target, start: current.start }
        : null,
    caches,
    items,
    baselines,
    warnings,
    fetchedAt: Date.now(),
  }
}

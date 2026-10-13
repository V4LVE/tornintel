import type {
  LevellingListChange,
  LevellingPlayer,
  LevellingTier,
  RawListPlayer,
} from '#/models/levelling'

// Ten levels per tier so every Torn level (1-100) belongs to exactly one tier.
export const LEVELLING_TIERS = {
  tier1: { name: 'Tier 1', min: 1, max: 10 },
  tier2: { name: 'Tier 2', min: 11, max: 20 },
  tier3: { name: 'Tier 3', min: 21, max: 30 },
  tier4: { name: 'Tier 4', min: 31, max: 40 },
  tier5: { name: 'Tier 5', min: 41, max: 50 },
  tier6: { name: 'Tier 6', min: 51, max: 60 },
  tier7: { name: 'Tier 7', min: 61, max: 70 },
  tier8: { name: 'Tier 8', min: 71, max: 80 },
  tier9: { name: 'Tier 9', min: 81, max: 90 },
  tier10: { name: 'Tier 10', min: 91, max: 100 },
} as const satisfies Record<
  LevellingTier,
  { name: string; min: number; max: number }
>

export function isLevellingTier(value: unknown): value is LevellingTier {
  return typeof value === 'string' && Object.hasOwn(LEVELLING_TIERS, value)
}

export function tierForLevel(level: number): LevellingTier | null {
  const entry = Object.entries(LEVELLING_TIERS).find(
    ([, tier]) => level >= tier.min && level <= tier.max,
  )
  return entry ? (entry[0] as LevellingTier) : null
}

export function parseStat(value: unknown) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0
  if (typeof value !== 'string') return 0
  return Number(value.replace(/,/g, '')) || 0
}

export function normalizePlayers(entries: RawListPlayer[]) {
  // Duplicate IDs keep the first entry.
  const players = new Map<number, LevellingPlayer>()
  for (const entry of entries) {
    const id = Number(entry.id)
    const level = Number(entry.lvl)
    if (!Number.isInteger(id) || id <= 0 || !Number.isInteger(level)) continue
    if (players.has(id)) continue
    players.set(id, {
      id,
      name: String(entry.name),
      level,
      total: parseStat(entry.total),
      str: parseStat(entry.str),
      def: parseStat(entry.def),
      spd: parseStat(entry.spd),
      dex: parseStat(entry.dex),
    })
  }
  return [...players.values()].sort((a, b) => a.total - b.total)
}

export function applyListChanges(
  bundled: LevellingPlayer[],
  changes: LevellingListChange[],
) {
  const players = new Map(bundled.map((player) => [player.id, player]))
  for (const change of changes) {
    if (change.removed) {
      players.delete(change.playerId)
    } else if (!players.has(change.playerId)) {
      players.set(change.playerId, {
        id: change.playerId,
        name: change.name,
        level: change.level,
        total: change.totalEstimate ?? 0,
        str: null,
        def: null,
        spd: null,
        dex: null,
        addedBy:
          change.addedById && change.addedByName
            ? { id: change.addedById, name: change.addedByName }
            : undefined,
      })
    }
  }
  return [...players.values()].sort((a, b) => a.total - b.total)
}

export function playersInTier(tier: LevellingTier, players: LevellingPlayer[]) {
  const { min, max } = LEVELLING_TIERS[tier]
  return players.filter((player) => player.level >= min && player.level <= max)
}

export function shuffle<T>(items: T[]) {
  const result = [...items]
  for (let index = result.length - 1; index > 0; index--) {
    const other = Math.floor(Math.random() * (index + 1))
    ;[result[index], result[other]] = [result[other], result[index]]
  }
  return result
}

import { db } from '#/db'
import { levellingListChanges } from '#/db/schema'
import players from './players.json'
import { applyListChanges, normalizePlayers } from './levelling'
import type { LevellingListChange } from './levelling'

export const bundledPlayers = normalizePlayers(players)

export const levellingListRepository = {
  async load(): Promise<LevellingListChange[]> {
    return db.select().from(levellingListChanges)
  },
  async save(change: LevellingListChange & { changedById: number }) {
    const { playerId: _playerId, ...values } = change
    await db
      .insert(levellingListChanges)
      .values({ ...change, changedAt: new Date() })
      .onConflictDoUpdate({
        target: levellingListChanges.playerId,
        set: { ...values, changedAt: new Date() },
      })
  },
}

// Without storage the bundled lists still work; only shared changes are missing.
export async function loadLevellingPlayers() {
  if (!process.env.DATABASE_URL) {
    return {
      players: bundledPlayers,
      removedIds: new Set<number>(),
      warning:
        'Shared list storage is not configured. Showing the original lists only.',
    }
  }
  try {
    const changes = await levellingListRepository.load()
    return {
      players: applyListChanges(bundledPlayers, changes),
      removedIds: new Set(
        changes
          .filter((change) => change.removed)
          .map((change) => change.playerId),
      ),
    }
  } catch {
    console.warn('[tornintel] Levelling list storage failed')
    return {
      players: bundledPlayers,
      removedIds: new Set<number>(),
      warning:
        'Shared list changes could not be loaded. Showing the original lists only.',
    }
  }
}

function idsFromEnv(name: string) {
  return new Set(
    (process.env[name] ?? '')
      .split(',')
      .map((id) => Number(id.trim()))
      .filter((id) => Number.isInteger(id) && id > 0),
  )
}

// Removing players hides them for everyone, so only trusted editors may do it.
// Editors are configured on the server; with neither variable set, nobody can.
export function isLevellingEditor(player: {
  id: number
  factionId: number | null
}) {
  return (
    idsFromEnv('LEVELLING_EDITOR_IDS').has(player.id) ||
    (player.factionId !== null &&
      idsFromEnv('LEVELLING_EDITOR_FACTION_IDS').has(player.factionId))
  )
}

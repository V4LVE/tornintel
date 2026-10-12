import { db } from '#/db'
import { levellingListChanges } from '#/db/schema'
import players from './levelling/players.json'
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
      warning:
        'Shared list storage is not configured. Showing the original lists only.',
    }
  }
  try {
    const changes = await levellingListRepository.load()
    return { players: applyListChanges(bundledPlayers, changes) }
  } catch {
    console.warn('[tornintel] Levelling list storage failed')
    return {
      players: bundledPlayers,
      warning:
        'Shared list changes could not be loaded. Showing the original lists only.',
    }
  }
}

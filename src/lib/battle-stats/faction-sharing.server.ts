import { and, eq, gte, inArray } from 'drizzle-orm'
import { db } from '#/db'
import { sharedStatSnapshots, statSharing } from '#/db/schema'
import { fetchTorn } from '#/lib/torn-api.server'
import { dayEnd } from './my-stats'
import type { StatPoint } from './my-stats'

export type PlayerIdentity = {
  id: string
  name: string
  /** Null when the player is not in a faction. */
  factionId: string | null
  factionName: string | null
}

type TornProfileResponse = {
  player_id?: number
  name?: string
  faction?: { faction_id?: number; faction_name?: string }
}

const HISTORY_DAYS = 365

/** Resolves who owns a key. Identity always comes from Torn, never the client. */
export async function fetchPlayerIdentity(
  apiKey: string,
): Promise<PlayerIdentity> {
  const url = new URL('https://api.torn.com/user/')
  url.searchParams.set('selections', 'profile')
  url.searchParams.set('key', apiKey)
  const { data } = await fetchTorn<TornProfileResponse>(url, {
    maxAgeMs: 5 * 60 * 1000,
  })
  if (!data.player_id || !data.name)
    throw new Error('Torn returned an incomplete profile.')
  const factionId = data.faction?.faction_id
  return {
    id: String(data.player_id),
    name: data.name,
    factionId: factionId ? String(factionId) : null,
    factionName: factionId ? (data.faction?.faction_name ?? null) : null,
  }
}

export const statSharingRepository = {
  async isSharing(playerId: string) {
    const rows = await db
      .select({ playerId: statSharing.playerId })
      .from(statSharing)
      .where(eq(statSharing.playerId, playerId))
    return rows.length > 0
  },
  async enable(identity: PlayerIdentity & { factionId: string }) {
    await db
      .insert(statSharing)
      .values({
        playerId: identity.id,
        playerName: identity.name,
        factionId: identity.factionId,
      })
      .onConflictDoUpdate({
        target: statSharing.playerId,
        set: {
          playerName: identity.name,
          factionId: identity.factionId,
          updatedAt: new Date(),
        },
      })
  },
  // Opting out removes everything that was shared.
  async disable(playerId: string) {
    await db.transaction(async (tx) => {
      await tx
        .delete(sharedStatSnapshots)
        .where(eq(sharedStatSnapshots.playerId, playerId))
      await tx.delete(statSharing).where(eq(statSharing.playerId, playerId))
    })
  },
  /** Saves readings only if the player is still sharing, and refreshes their faction. */
  async record(identity: PlayerIdentity, points: StatPoint[]) {
    if (points.length === 0) return
    await db.transaction(async (tx) => {
      const updated = await tx
        .update(statSharing)
        .set({
          playerName: identity.name,
          factionId: identity.factionId ?? '',
          updatedAt: new Date(),
        })
        .where(eq(statSharing.playerId, identity.id))
        .returning({ playerId: statSharing.playerId })
      if (updated.length === 0) return
      for (const point of points) {
        const row = { ...point, playerId: identity.id }
        await tx
          .insert(sharedStatSnapshots)
          .values(row)
          .onConflictDoUpdate({
            target: [
              sharedStatSnapshots.playerId,
              sharedStatSnapshots.timestamp,
            ],
            set: row,
          })
      }
    })
  },
  async loadFaction(factionId: string, memberIds: string[], since: number) {
    if (memberIds.length === 0) return { sharers: [], snapshots: [] }
    const sharers = await db
      .select()
      .from(statSharing)
      .where(
        and(
          eq(statSharing.factionId, factionId),
          inArray(statSharing.playerId, memberIds),
        ),
      )
    if (sharers.length === 0) return { sharers, snapshots: [] }
    const snapshots = await db
      .select()
      .from(sharedStatSnapshots)
      .where(
        and(
          inArray(
            sharedStatSnapshots.playerId,
            sharers.map((sharer) => sharer.playerId),
          ),
          gte(sharedStatSnapshots.timestamp, since),
        ),
      )
      .orderBy(sharedStatSnapshots.timestamp)
    return { sharers, snapshots }
  },
}

/**
 * Stores server-fetched readings for a player who opted in. Recording is
 * best effort: My stats keeps working if Torn or the database is unavailable.
 */
export async function recordSharedStats(
  apiKey: string,
  points: StatPoint[],
  identity?: PlayerIdentity,
) {
  if (!process.env.DATABASE_URL || points.length === 0) return
  try {
    const owner = identity ?? (await fetchPlayerIdentity(apiKey))
    await statSharingRepository.record(
      owner,
      points.map((point) => ({ ...point, timestamp: dayEnd(point.timestamp) })),
    )
  } catch (error) {
    console.warn('[tornintel] Could not record shared stats', {
      message: error instanceof Error ? error.message : String(error),
    })
  }
}

export function sharedHistorySince(now = Date.now() / 1000) {
  return Math.floor(now) - HISTORY_DAYS * 86_400
}

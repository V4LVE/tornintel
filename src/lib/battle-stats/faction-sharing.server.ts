import { and, eq, gte, inArray, sql } from 'drizzle-orm'
import { db } from '#/db'
import { sharedStatSnapshots, statSharing } from '#/db/schema'
import { fetchTorn } from '#/lib/torn/torn-api.server'
import { dayEnd } from './my-stats'
import type { ObservedStatPoint, PlayerIdentity } from '#/models/my-stats'
import type { TornUserResponse } from '#/models/torn'

const HISTORY_DAYS = 365

/** Resolves who owns a key. Identity always comes from Torn, never the client. */
export async function fetchPlayerIdentity(
  apiKey: string,
): Promise<PlayerIdentity> {
  const url = new URL('https://api.torn.com/user/')
  url.searchParams.set('selections', 'profile')
  url.searchParams.set('key', apiKey)
  const { data } = await fetchTorn<TornUserResponse>(url, {
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
  // Sharing is on by default, so a player without a row is sharing.
  async isSharing(playerId: string) {
    const rows = await db
      .select({ enabled: statSharing.enabled })
      .from(statSharing)
      .where(eq(statSharing.playerId, playerId))
    return rows.length === 0 || rows[0].enabled
  },
  async enable(identity: PlayerIdentity & { factionId: string }) {
    await db
      .insert(statSharing)
      .values({
        playerId: identity.id,
        playerName: identity.name,
        factionId: identity.factionId,
        enabled: true,
      })
      .onConflictDoUpdate({
        target: statSharing.playerId,
        set: {
          playerName: identity.name,
          factionId: identity.factionId,
          enabled: true,
          updatedAt: new Date(),
        },
      })
  },
  // Opting out deletes everything that was shared and remembers the choice, so
  // the default does not switch sharing back on.
  async disable(identity: PlayerIdentity) {
    await db.transaction(async (tx) => {
      // Writing the row first waits for any record() holding its lock, so the
      // delete below sees that record's snapshots.
      await tx
        .insert(statSharing)
        .values({
          playerId: identity.id,
          playerName: identity.name,
          factionId: identity.factionId ?? '',
          enabled: false,
        })
        .onConflictDoUpdate({
          target: statSharing.playerId,
          set: { enabled: false, updatedAt: new Date() },
        })
      await tx
        .delete(sharedStatSnapshots)
        .where(eq(sharedStatSnapshots.playerId, identity.id))
    })
  },
  /**
   * Saves readings unless the player opted out, and refreshes their faction.
   * A player seen for the first time starts sharing, because that is the default. Each point's timestamp is its day bucket; a reading replaces the
   * stored one for that day only when it was observed at the same time or later.
   */
  async record(identity: PlayerIdentity, points: ObservedStatPoint[]) {
    if (points.length === 0) return
    await db.transaction(async (tx) => {
      const profile = {
        playerName: identity.name,
        factionId: identity.factionId ?? '',
      }
      // Returns nothing when the row exists with sharing turned off.
      const sharing = await tx
        .insert(statSharing)
        .values({ playerId: identity.id, ...profile })
        .onConflictDoUpdate({
          target: statSharing.playerId,
          set: { ...profile, updatedAt: new Date() },
          setWhere: eq(statSharing.enabled, true),
        })
        .returning({ playerId: statSharing.playerId })
      if (sharing.length === 0) return
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
            setWhere: sql`${sharedStatSnapshots.observedAt} <= excluded.observed_at`,
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
          eq(statSharing.enabled, true),
          inArray(statSharing.playerId, memberIds),
        ),
      )
    if (sharers.length === 0) return { sharers, snapshots: [] }
    const snapshots = await db
      .select({
        playerId: sharedStatSnapshots.playerId,
        timestamp: sharedStatSnapshots.timestamp,
        strength: sharedStatSnapshots.strength,
        defense: sharedStatSnapshots.defense,
        speed: sharedStatSnapshots.speed,
        dexterity: sharedStatSnapshots.dexterity,
        total: sharedStatSnapshots.total,
      })
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
 * Stores server-fetched readings unless the player opted out. Recording is
 * best effort: My stats keeps working if Torn or the database is unavailable.
 */
export async function recordSharedStats(
  apiKey: string,
  points: ObservedStatPoint[],
  identity?: PlayerIdentity,
) {
  if (!process.env.DATABASE_URL || points.length === 0) return
  try {
    const owner = identity ?? (await fetchPlayerIdentity(apiKey))
    await statSharingRepository.record(
      owner,
      points.map((point) => ({
        ...point,
        timestamp: dayEnd(point.timestamp),
        observedAt: Math.floor(point.observedAt),
      })),
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

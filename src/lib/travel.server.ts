import { inArray, sql } from 'drizzle-orm'
import { db } from '#/db'
import { factionMemberTravel } from '#/db/schema'
import { estimateTravel, observeTravel } from './travel'
import type { MemberStatus, TravelSnapshot } from './travel'

type MemberObservation = { playerId: string; status: MemberStatus }
const memory = new Map<string, TravelSnapshot>()

export const travelTrackingRepository = {
  async sync(members: MemberObservation[], observedAt: number) {
    if (members.length === 0) return new Map<string, TravelSnapshot>()
    return db.transaction(async (tx) => {
      // Insert placeholders and lock rows in consistent player order so concurrent
      // viewers cannot reset a flight or replace a newer status with a cached one.
      const ordered = [...members].sort((a, b) =>
        a.playerId.localeCompare(b.playerId),
      )
      await tx
        .insert(factionMemberTravel)
        .values(
          ordered.map(({ playerId }) => ({
            playerId,
            snapshot: {
              state: 'Unknown',
              routeKey: null,
              observedAt: 0,
              firstSeenAt: null,
              departureEarliestAt: null,
            },
          })),
        )
        .onConflictDoNothing()
      const rows = await tx
        .select()
        .from(factionMemberTravel)
        .where(
          inArray(
            factionMemberTravel.playerId,
            ordered.map((member) => member.playerId),
          ),
        )
        .orderBy(factionMemberTravel.playerId)
        .for('update')
      const previous = new Map(rows.map((row) => [row.playerId, row.snapshot]))
      const updated = ordered.map(({ playerId, status }) => ({
        playerId,
        snapshot: observeTravel(status, observedAt, previous.get(playerId)),
      }))
      await tx
        .insert(factionMemberTravel)
        .values(updated)
        .onConflictDoUpdate({
          target: factionMemberTravel.playerId,
          set: { snapshot: sql`excluded.snapshot` },
        })
      return new Map(updated.map((row) => [row.playerId, row.snapshot]))
    })
  },
}

export async function syncTravelTracking(
  members: MemberObservation[],
  observedAt: number,
) {
  let snapshots: Map<string, TravelSnapshot>
  let reason: string | undefined
  try {
    if (!process.env.DATABASE_URL) throw new Error('not configured')
    snapshots = await travelTrackingRepository.sync(members, observedAt)
  } catch {
    reason =
      'Travel tracking is temporarily stored on this server. Shared tracking will resume when storage is available.'
    snapshots = new Map(
      members.map(({ playerId, status }) => [
        playerId,
        observeTravel(status, observedAt, memory.get(playerId)),
      ]),
    )
  }
  for (const [id, snapshot] of snapshots) {
    memory.delete(id)
    memory.set(id, snapshot)
  }
  while (memory.size > 5000) memory.delete(memory.keys().next().value!)
  return {
    travel: new Map(
      members.map(({ playerId, status }) => [
        playerId,
        estimateTravel(status, snapshots.get(playerId)!),
      ]),
    ),
    reason,
  }
}

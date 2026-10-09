import { inArray } from 'drizzle-orm'
import { db } from '#/db'
import { sharedFairFightObservations } from '#/db/schema'
import type { FairFightObservation } from './estimator'

export type SharedObservation = {
  evidenceId: string
  playerId: string
  sourcePlayerId: string
  observation: FairFightObservation
}

// Save only server-fetched combat evidence, never client-supplied estimates or keys.
export const sharedEvidenceRepository = {
  async save(evidence: SharedObservation[]) {
    if (evidence.length === 0) return
    // Preserve the first captured stats for a hit, even after the observer trains.
    await db
      .insert(sharedFairFightObservations)
      .values(evidence)
      .onConflictDoNothing()
  },
  async load(playerIds: string[]): Promise<SharedObservation[]> {
    if (playerIds.length === 0) return []
    return db
      .select()
      .from(sharedFairFightObservations)
      .where(inArray(sharedFairFightObservations.playerId, playerIds))
  },
}

export async function syncSharedEvidence(
  evidence: SharedObservation[],
  playerIds: string[],
) {
  const combined = new Map(evidence.map((item) => [item.evidenceId, item]))
  let reason: string | undefined
  if (!process.env.DATABASE_URL) {
    reason =
      'Shared TBS storage is not configured. Only your own fights are shown.'
  } else {
    // Read even if a write fails so previously shared estimates remain usable.
    try {
      await sharedEvidenceRepository.save(evidence)
    } catch {
      reason =
        'Your latest fights could not be saved. Shared TBS storage is temporarily unavailable.'
    }
    try {
      for (const item of await sharedEvidenceRepository.load(playerIds)) {
        combined.set(item.evidenceId, item)
      }
    } catch {
      reason = 'Shared TBS could not be loaded. Only your own fights are shown.'
    }
    if (reason) console.warn('[tornintel] Shared TBS storage failed')
  }
  const observations = new Map<string, FairFightObservation[]>()
  const contributors = new Map<string, string[]>()
  for (const item of combined.values()) {
    const target = observations.get(item.playerId) ?? []
    target.push(item.observation)
    observations.set(item.playerId, target)
    const sources = contributors.get(item.playerId) ?? []
    if (!sources.includes(item.sourcePlayerId))
      sources.push(item.sourcePlayerId)
    contributors.set(item.playerId, sources)
  }
  return {
    observations,
    contributors,
    status: reason ? 'UNAVAILABLE' : 'READY',
    reason,
  } as const
}

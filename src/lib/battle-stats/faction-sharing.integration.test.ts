import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { test } from 'node:test'
import { eq } from 'drizzle-orm'
import { db } from '#/db'
import { sharedStatSnapshots, statSharing } from '#/db/schema'
import { statSharingRepository } from './faction-sharing.server'
import type { ObservedStatPoint, PlayerIdentity } from '#/models/my-stats'

const reading = (total: number, observedAt: number): ObservedStatPoint => ({
  timestamp: 1700006399,
  observedAt,
  strength: total / 4,
  defense: total / 4,
  speed: total / 4,
  dexterity: total / 4,
  total,
})

test(
  'PostgreSQL keeps the newest reading within a day',
  {
    skip: process.env.TORNINTEL_DB_TEST !== '1',
  },
  async () => {
    const identity: PlayerIdentity = {
      id: `tornintel-test:${randomUUID()}`,
      name: 'Stat Sharer',
      factionId: '555',
      factionName: 'Test Faction',
    }
    const totals = async () =>
      (
        await statSharingRepository.loadFaction('555', [identity.id], 0)
      ).snapshots.map((snapshot) => snapshot.total)
    try {
      await statSharingRepository.enable({ ...identity, factionId: '555' })
      await statSharingRepository.record(identity, [reading(400, 1700005000)])
      await statSharingRepository.record(identity, [reading(40, 1700000000)])
      assert.deepEqual(await totals(), [400])
      await statSharingRepository.record(identity, [reading(500, 1700006000)])
      assert.deepEqual(await totals(), [500])
    } finally {
      await db
        .delete(sharedStatSnapshots)
        .where(eq(sharedStatSnapshots.playerId, identity.id))
      await db.delete(statSharing).where(eq(statSharing.playerId, identity.id))
      await db.$client.end()
    }
  },
)

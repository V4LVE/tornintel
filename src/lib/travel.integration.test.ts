import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { test } from 'node:test'
import { eq } from 'drizzle-orm'
import { db } from '#/db'
import { factionMemberTravel } from '#/db/schema'
import { estimateTravel } from './travel'
import { travelTrackingRepository } from './travel.server'

test(
  'PostgreSQL shares flight departure across viewers and rejects older observations',
  {
    skip: process.env.TORNINTEL_DB_TEST !== '1',
  },
  async () => {
    const playerId = `tornintel-test:${randomUUID()}`
    const start = Date.now()
    const flight = { state: 'Traveling', description: 'Returning from Japan' }
    try {
      await travelTrackingRepository.sync(
        [{ playerId, status: { state: 'Abroad' } }],
        start,
      )
      const departed = await travelTrackingRepository.sync(
        [{ playerId, status: flight }],
        start + 30000,
      )
      const first = estimateTravel(flight, departed.get(playerId)!)!
      assert.equal(first.departureObserved, true)
      const anotherViewer = await travelTrackingRepository.sync(
        [{ playerId, status: flight }],
        start + 60000,
      )
      assert.deepEqual(
        estimateTravel(flight, anotherViewer.get(playerId)!),
        first,
      )
      const [latest, stale] = await Promise.all([
        travelTrackingRepository.sync(
          [{ playerId, status: flight }],
          start + 90000,
        ),
        travelTrackingRepository.sync(
          [{ playerId, status: { state: 'Abroad' } }],
          start,
        ),
      ])
      assert.equal(latest.get(playerId)?.state, 'Traveling')
      assert.equal(stale.get(playerId)?.state, 'Traveling')
      const saved = await db
        .select()
        .from(factionMemberTravel)
        .where(eq(factionMemberTravel.playerId, playerId))
      assert.equal(saved[0].snapshot.observedAt, start + 90000)
      assert.equal(saved[0].snapshot.firstSeenAt, start + 30000)
    } finally {
      await db
        .delete(factionMemberTravel)
        .where(eq(factionMemberTravel.playerId, playerId))
      await db.$client.end()
    }
  },
)

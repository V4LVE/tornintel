import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { after, test } from 'node:test'
import { eq } from 'drizzle-orm'
import { db } from '#/db'
import { sharedStatSnapshots, statSharing } from '#/db/schema'
import { statSharingRepository } from './faction-sharing.server'
import type { ObservedStatPoint, PlayerIdentity } from '#/models/my-stats'

const skip = process.env.TORNINTEL_DB_TEST !== '1'

// The tests share one pool; close it once they are done.
after(async () => {
  if (!skip) await db.$client.end()
})

const newIdentity = (): PlayerIdentity => ({
  id: `tornintel-test:${randomUUID()}`,
  name: 'Stat Sharer',
  factionId: '555',
  factionName: 'Test Faction',
})

async function removePlayer(playerId: string) {
  await db
    .delete(sharedStatSnapshots)
    .where(eq(sharedStatSnapshots.playerId, playerId))
  await db.delete(statSharing).where(eq(statSharing.playerId, playerId))
}

const reading = (total: number, observedAt: number): ObservedStatPoint => ({
  timestamp: 1700006399,
  observedAt,
  strength: total / 4,
  defense: total / 4,
  speed: total / 4,
  dexterity: total / 4,
  total,
})

test('PostgreSQL keeps the newest reading within a day', { skip }, async () => {
  const identity = newIdentity()
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
    await removePlayer(identity.id)
  }
})

test(
  'PostgreSQL shares by default and remembers an opt-out',
  { skip },
  async () => {
    const identity = newIdentity()
    const shared = async () =>
      (await statSharingRepository.loadFaction('555', [identity.id], 0))
        .snapshots.length
    try {
      assert.equal(await statSharingRepository.isSharing(identity.id), true)
      await statSharingRepository.record(identity, [reading(400, 1700005000)])
      assert.equal(await shared(), 1)

      await statSharingRepository.disable(identity)
      assert.equal(await statSharingRepository.isSharing(identity.id), false)
      assert.equal(await shared(), 0)
      await statSharingRepository.record(identity, [reading(500, 1700006000)])
      assert.equal(await shared(), 0, 'an opt-out is not undone by the default')

      await statSharingRepository.enable({ ...identity, factionId: '555' })
      await statSharingRepository.record(identity, [reading(600, 1700006100)])
      assert.equal(await shared(), 1)
    } finally {
      await removePlayer(identity.id)
    }
  },
)

test(
  'PostgreSQL remembers an opt-out made before any reading',
  { skip },
  async () => {
    const identity = newIdentity()
    try {
      await statSharingRepository.disable(identity)
      await statSharingRepository.record(identity, [reading(400, 1700005000)])
      assert.equal(await statSharingRepository.isSharing(identity.id), false)
      const { sharers, snapshots } = await statSharingRepository.loadFaction(
        '555',
        [identity.id],
        0,
      )
      assert.equal(sharers.length, 0)
      assert.equal(snapshots.length, 0)
    } finally {
      await removePlayer(identity.id)
    }
  },
)

import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { test } from 'node:test'
import { eq } from 'drizzle-orm'
import { Client } from 'pg'
import { db } from '#/db'
import { sharedFairFightObservations } from '#/db/schema'
import { sharedEvidenceRepository } from './shared-evidence.server'
import type { SharedObservation } from './shared-evidence.server'

test(
  'PostgreSQL preserves the original hit and makes it visible on another connection',
  {
    skip: process.env.TORNINTEL_DB_TEST !== '1',
  },
  async () => {
    const playerId = `tornintel-test:${randomUUID()}`
    const evidence: SharedObservation = {
      evidenceId: `${playerId}:hit`,
      playerId,
      sourcePlayerId: '789',
      observation: {
        targetId: playerId,
        attackerId: '789',
        attackerBss: 4000,
        attackerBalanceFactor: 1,
        fairFight: 2,
        timestamp: 1700000000000,
      },
    }
    const reader = new Client({
      connectionString: process.env.DATABASE_URL,
      connectionTimeoutMillis: 5000,
    })
    try {
      await sharedEvidenceRepository.save([evidence])
      await sharedEvidenceRepository.save([
        {
          ...evidence,
          observation: { ...evidence.observation, attackerBss: 8000 },
        },
      ])
      const loaded = await sharedEvidenceRepository.load([playerId])
      assert.equal(loaded.length, 1)
      assert.deepEqual(loaded[0].observation, evidence.observation)
      assert.deepEqual(
        await sharedEvidenceRepository.load([`${playerId}:other`]),
        [],
      )
      await reader.connect()
      const independent = await reader.query(
        'select observation from shared_fair_fight_observations where evidence_id = $1',
        [evidence.evidenceId],
      )
      assert.deepEqual(independent.rows[0].observation, evidence.observation)
    } finally {
      await reader.end()
      await db
        .delete(sharedFairFightObservations)
        .where(eq(sharedFairFightObservations.evidenceId, evidence.evidenceId))
      await db.$client.end()
    }
  },
)

import assert from 'node:assert/strict'
import test from 'node:test'
import {
  calculateBalanceFactor,
  calculateBattleStatScore,
  estimateAttackerBssFromFairFight,
  estimateBattleStats,
  estimateBssFromFairFight,
  totalBattleStats,
} from './estimator'

const now = 1_700_000_000_000
const balanced = { strength: 100, speed: 100, defense: 100, dexterity: 100 }

test('calculates BSS, total, and balance factor for balanced stats', () => {
  assert.equal(calculateBattleStatScore(balanced), 40)
  assert.equal(totalBattleStats(balanced), 400)
  assert.equal(calculateBalanceFactor(balanced), 1)
})

test('supports highly unbalanced and very large stats without loss of finiteness', () => {
  const stats = { strength: 1e100, speed: 0, defense: 0, dexterity: 0 }
  assert.ok(Math.abs(calculateBalanceFactor(stats) - 4) < Number.EPSILON * 8)
  assert.ok(Number.isFinite(calculateBattleStatScore(stats)))
})

test('inverts uncapped Fair Fight and rejects boundary values', () => {
  assert.equal(estimateBssFromFairFight(2, 800), 300)
  assert.equal(estimateBssFromFairFight(1, 800), null)
  assert.equal(estimateBssFromFairFight(1.01, 800), null)
  assert.equal(estimateBssFromFairFight(1.05, 800), null)
  assert.ok(estimateBssFromFairFight(2.99, 800))
  assert.equal(estimateBssFromFairFight(3, 800), null)
})

test('inverts an incoming Fair Fight score to estimate the attacker', () => {
  assert.ok(
    Math.abs((estimateAttackerBssFromFairFight(7 / 3, 2_000) ?? 0) - 4_000) <
      0.001,
  )
  const result = estimateBattleStats({
    now,
    fairFightObservations: [
      {
        targetId: '1',
        attackerId: '1',
        attackerBss: 2_000,
        defenderBss: 2_000,
        attackerBalanceFactor: 1,
        fairFight: 7 / 3,
        timestamp: now,
      },
    ],
  })
  assert.ok(Math.abs((result.bss ?? 0) - 4_000) < 0.001)
  assert.equal(result.estimate, 4_000_000)
  assert.deepEqual(result.sources, ['FAIR_FIGHT'])
})

test('does not invent a total-stat estimate without Fair Fight evidence', () => {
  const result = estimateBattleStats({ now })
  assert.equal(result.estimate, null)
  assert.deepEqual(result.sources, ['FALLBACK'])
})

test('uses exact stats ahead of every estimate source', () => {
  const result = estimateBattleStats({
    now,
    exactStats: balanced,
    spy: { totalStats: 99_000, timestamp: now - 1 },
    fairFightObservations: [
      {
        targetId: '1',
        attackerId: '2',
        attackerBss: 800,
        fairFight: 2,
        timestamp: now,
      },
    ],
  })
  assert.equal(result.estimate, 400)
  assert.deepEqual(result.sources, ['EXACT'])
  assert.equal(result.confidence, 100)
})

test('aggregates agreeing observations and rejects an obvious outlier', () => {
  const observations = [2, 2.01, 1.99, 2.8].map((fairFight, index) => ({
    targetId: '1',
    attackerId: String(index),
    attackerBss: 800,
    fairFight,
    timestamp: now - index * 1_000,
    attackerStatsExact: true,
  }))
  const result = estimateBattleStats({
    now,
    fairFightObservations: observations,
  })
  assert.equal(result.diagnostics.observationsAccepted, 3)
  assert.equal(result.diagnostics.observationsRejected, 1)
  assert.ok(result.bss && Math.abs(result.bss - 300) < 5)
  assert.ok(
    result.lowerBound &&
      result.upperBound &&
      result.lowerBound < result.upperBound,
  )
})

test('uses an old spy as a historical lower bound', () => {
  const result = estimateBattleStats({
    now,
    spy: { totalStats: 52_000_000, timestamp: now - 90 * 86_400_000 },
  })
  assert.equal(result.lowerBound, 52_000_000)
  assert.equal(result.upperBound, null)
  assert.match(result.explanation, /historical lower bound/)
})

test('lets a recent spy override Fair Fight, but retains an old spy as a bound', () => {
  const observation = {
    targetId: '1',
    attackerId: '2',
    attackerBss: 800,
    fairFight: 2,
    timestamp: now,
  }
  const recent = estimateBattleStats({
    now,
    spy: { totalStats: 9_000_000, timestamp: now - 1_000 },
    fairFightObservations: [observation],
  })
  assert.deepEqual(recent.sources, ['SPY'])
  const historical = estimateBattleStats({
    now,
    spy: { totalStats: 1_000_000, timestamp: now - 31 * 86_400_000 },
    fairFightObservations: [observation],
  })
  assert.ok(historical.lowerBound && historical.lowerBound >= 1_000_000)
  assert.ok(historical.sources.includes('SPY'))
})

test('uses agreeing rank evidence as a constraint and flags conflicts', () => {
  const observation = {
    targetId: '1',
    attackerId: '2',
    attackerBss: 8_000,
    fairFight: 2,
    timestamp: now,
  }
  const agreeing = estimateBattleStats({
    now,
    fairFightObservations: [observation],
    rankEvidence: {
      lowerBound: 1_000_000,
      upperBound: 30_000_000,
      timestamp: now,
    },
  })
  assert.equal(agreeing.diagnostics.rankConstraintUsed, true)
  const conflicting = estimateBattleStats({
    now,
    fairFightObservations: [observation],
    rankEvidence: {
      lowerBound: 100_000_000,
      upperBound: 200_000_000,
      timestamp: now,
    },
  })
  assert.equal(conflicting.diagnostics.evidenceConflict, true)
  assert.ok(
    conflicting.warnings.some((warning) => warning.includes('conflicts')),
  )
})

test('uses a high capped Fair Fight score as a battle-stat lower bound', () => {
  const result = estimateBattleStats({
    now,
    fairFightObservations: [
      {
        targetId: '1',
        attackerId: '2',
        attackerBss: 800,
        fairFight: 3,
        timestamp: now,
      },
    ],
  })
  assert.equal(result.estimate, null)
  assert.ok(result.lowerBound)
  assert.equal(result.upperBound, null)
  assert.deepEqual(result.sources, ['FAIR_FIGHT'])
  assert.match(result.explanation, /lower bound/)
})

test('uses a low capped Fair Fight score as a battle-stat upper bound', () => {
  const result = estimateBattleStats({
    now,
    fairFightObservations: [
      {
        targetId: '1',
        attackerId: '2',
        attackerBss: 800,
        fairFight: 1,
        timestamp: now,
      },
    ],
  })
  assert.equal(result.estimate, null)
  assert.equal(result.lowerBound, 0)
  assert.ok(result.upperBound)
  assert.deepEqual(result.sources, ['FAIR_FIGHT'])
  assert.match(result.explanation, /upper bound/)
})

test("scales the attacker's total stats by the squared Fair Fight score ratio", () => {
  const observation = {
    targetId: '1',
    attackerId: '2',
    attackerBss: 4_000,
    attackerBalanceFactor: 1,
    fairFight: 2,
    timestamp: now,
  }
  const balancedResult = estimateBattleStats({
    now,
    fairFightObservations: [observation],
  })
  const skewedResult = estimateBattleStats({
    now,
    fairFightObservations: [{ ...observation, attackerBalanceFactor: 2 }],
    weakMetadata: { age: 400, level: 50, medals: 80 },
  })
  assert.equal(balancedResult.bss, 1_500)
  assert.equal(balancedResult.estimate, 562_500)
  assert.equal(skewedResult.estimate, 1_125_000)
  assert.deepEqual(skewedResult.sources, ['FAIR_FIGHT'])

  const higherFairFight = estimateBattleStats({
    now,
    fairFightObservations: [{ ...observation, fairFight: 2.5 }],
  })
  assert.equal(higherFairFight.estimate, 1_265_625)
})

test('keeps profile metadata from overriding a measured Fair Fight score', () => {
  const observation = {
    targetId: '1',
    attackerId: '2',
    attackerBss: 4_000,
    attackerBalanceFactor: 1.2,
    fairFight: 2,
    timestamp: now,
  }
  const measured = estimateBattleStats({
    now,
    fairFightObservations: [observation],
  })
  const withMetadata = estimateBattleStats({
    now,
    fairFightObservations: [observation],
    weakMetadata: { age: 3_000, level: 100, medals: 100 },
  })
  assert.equal(withMetadata.estimate, measured.estimate)
})

test('returns a calibrated but low-confidence age/level prior', () => {
  const result = estimateBattleStats({
    now,
    weakMetadata: { age: 400, level: 50 },
  })
  assert.equal(result.confidence, 18)
  assert.equal(result.sources[0], 'FALLBACK')
  assert.ok(result.estimate && result.lowerBound && result.upperBound)
  assert.ok(result.upperBound / result.lowerBound > 40)
  assert.ok(result.estimate > result.lowerBound)
  assert.ok(result.estimate < result.upperBound)
})

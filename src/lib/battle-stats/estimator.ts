export type BattleStats = {
  strength: number
  speed: number
  defense: number
  dexterity: number
}

export type SpyEvidence = {
  totalStats: number
  individualStats?: BattleStats
  timestamp: number
}

export type FairFightObservation = {
  targetId: string
  attackerId: string
  attackerBss: number
  fairFight: number
  timestamp: number
  attackerStatsExact?: boolean
  top1000Capped?: boolean
}

export type RankEvidence = {
  lowerBound?: number
  upperBound?: number
  timestamp: number
  reliability?: number
  description?: string
}

export type CalibrationSample = { stats: BattleStats }
export type WeakMetadata = { age?: number; level?: number }

export type BattleStatsEstimate = {
  estimate: number | null
  lowerBound: number | null
  upperBound: number | null
  bss: number | null
  confidence: number
  confidenceLevel: 'LOW' | 'MEDIUM' | 'HIGH' | 'VERY_HIGH'
  sources: Array<'EXACT' | 'SPY' | 'FAIR_FIGHT' | 'RANK' | 'FALLBACK'>
  newestEvidenceAt: number | null
  explanation: string
  warnings: string[]
  diagnostics: {
    observationsReceived: number
    observationsAccepted: number
    observationsRejected: number
    weightedMedianBss: number | null
    bssSpread: number | null
    rankConstraintUsed: boolean
    evidenceConflict: boolean
  }
}

export const ESTIMATOR_CONFIG = {
  fairFight: { weakAtOrBelow: 1.01, cappedAtOrAbove: 2.99 },
  recencyHalfLifeDays: 30,
  recentSpyDays: 30,
  outlierRelativeDistance: 0.35,
  minCalibrationSamples: 8,
  fallbackBalanceFactors: { low: 1, median: 2, high: 4 },
  metadataPrior: {
    sampleSize: 200,
    intercept: -2.14101736574686,
    logAge: 2.16630747493162,
    logLevel: 1.05156113462195,
    residualP10: -0.713402942430077,
    residualP50: -0.0908951483273155,
    residualP90: 1.02113452723184,
  },
  confidence: {
    fairFightBase: 32,
    perAcceptedObservation: 9,
    exactAttackerBonus: 8,
    agreementBonus: 15,
    rankAgreementBonus: 6,
    rankOnly: 20,
    oldSpyPenaltyPer90Days: 15,
    conflictPenalty: 25,
    uncalibratedPenalty: 14,
  },
} as const

function assertStat(value: number) {
  if (!Number.isFinite(value) || value < 0) {
    throw new Error('Battle stats must be finite, non-negative numbers.')
  }
}

export function calculateBattleStatScore(stats: BattleStats): number {
  const values = [stats.strength, stats.speed, stats.defense, stats.dexterity]
  values.forEach(assertStat)
  return values.reduce((total, stat) => total + Math.sqrt(stat), 0)
}

export function totalBattleStats(stats: BattleStats): number {
  const values = [stats.strength, stats.speed, stats.defense, stats.dexterity]
  values.forEach(assertStat)
  return values.reduce((total, stat) => total + stat, 0)
}

export function calculateBalanceFactor(stats: BattleStats): number {
  const bss = calculateBattleStatScore(stats)
  if (bss === 0) return 1
  return totalBattleStats(stats) / ((bss * bss) / 4)
}

export function estimateBssFromFairFight(
  fairFight: number,
  attackerBss: number,
): number | null {
  if (
    !Number.isFinite(fairFight) ||
    !Number.isFinite(attackerBss) ||
    attackerBss <= 0 ||
    fairFight <= ESTIMATOR_CONFIG.fairFight.weakAtOrBelow ||
    fairFight >= ESTIMATOR_CONFIG.fairFight.cappedAtOrAbove
  ) {
    return null
  }
  return (fairFight - 1) * (3 / 8) * attackerBss
}

type WeightedValue = { value: number; weight: number }

function weightedMedian(values: WeightedValue[]): number {
  const sorted = [...values].sort((left, right) => left.value - right.value)
  const halfway = sorted.reduce((sum, item) => sum + item.weight, 0) / 2
  let cumulative = 0
  for (const item of sorted) {
    cumulative += item.weight
    if (cumulative >= halfway) return item.value
  }
  return sorted.at(-1)?.value ?? 0
}

function percentile(sortedValues: number[], fraction: number): number {
  if (sortedValues.length === 0) return 0
  const index = (sortedValues.length - 1) * fraction
  const lower = Math.floor(index)
  const upper = Math.ceil(index)
  return (
    sortedValues[lower] +
    (sortedValues[upper] - sortedValues[lower]) * (index - lower)
  )
}

function observationWeight(
  observation: FairFightObservation,
  now: number,
): number {
  const ageDays = Math.max(0, now - observation.timestamp) / 86_400_000
  const recency = Math.pow(0.5, ageDays / ESTIMATOR_CONFIG.recencyHalfLifeDays)
  const centre = Math.max(0, 1 - Math.abs(observation.fairFight - 2) / 1)
  return (
    recency * (0.2 + 0.8 * centre) * (observation.attackerStatsExact ? 1 : 0.7)
  )
}

function calibrationFactors(samples: CalibrationSample[]) {
  const factors = samples
    .map((sample) => calculateBalanceFactor(sample.stats))
    .filter(Number.isFinite)
    .sort((left, right) => left - right)
  if (factors.length < ESTIMATOR_CONFIG.minCalibrationSamples) {
    return { ...ESTIMATOR_CONFIG.fallbackBalanceFactors, calibrated: false }
  }
  return {
    low: percentile(factors, 0.1),
    median: percentile(factors, 0.5),
    high: percentile(factors, 0.9),
    calibrated: true,
  }
}

function confidenceLevel(
  confidence: number,
): BattleStatsEstimate['confidenceLevel'] {
  if (confidence >= 85) return 'VERY_HIGH'
  if (confidence >= 65) return 'HIGH'
  if (confidence >= 40) return 'MEDIUM'
  return 'LOW'
}

function newestTimestamp(values: Array<number | undefined>): number | null {
  const valid = values.filter(
    (value): value is number => typeof value === 'number',
  )
  return valid.length ? Math.max(...valid) : null
}

export function estimateBattleStats(input: {
  exactStats?: BattleStats
  spy?: SpyEvidence
  fairFightObservations?: FairFightObservation[]
  rankEvidence?: RankEvidence
  calibrationSamples?: CalibrationSample[]
  weakMetadata?: WeakMetadata
  now?: number
}): BattleStatsEstimate {
  const now = input.now ?? Date.now()
  const observations = input.fairFightObservations ?? []
  const baseDiagnostics = {
    observationsReceived: observations.length,
    observationsAccepted: 0,
    observationsRejected: 0,
    weightedMedianBss: null,
    bssSpread: null,
    rankConstraintUsed: false,
    evidenceConflict: false,
  }
  if (input.exactStats) {
    const total = totalBattleStats(input.exactStats)
    return {
      estimate: total,
      lowerBound: total,
      upperBound: total,
      bss: calculateBattleStatScore(input.exactStats),
      confidence: 100,
      confidenceLevel: 'VERY_HIGH',
      sources: ['EXACT'],
      newestEvidenceAt: now,
      explanation:
        'Exact four battle stats are available; no estimation was used.',
      warnings: [],
      diagnostics: baseDiagnostics,
    }
  }

  const spyAgeDays = input.spy
    ? Math.max(0, now - input.spy.timestamp) / 86_400_000
    : null
  if (
    input.spy &&
    spyAgeDays !== null &&
    spyAgeDays <= ESTIMATOR_CONFIG.recentSpyDays
  ) {
    return {
      estimate: input.spy.totalStats,
      lowerBound: input.spy.totalStats,
      upperBound: input.spy.totalStats,
      bss: input.spy.individualStats
        ? calculateBattleStatScore(input.spy.individualStats)
        : null,
      confidence: 82,
      confidenceLevel: 'VERY_HIGH',
      sources: ['SPY'],
      newestEvidenceAt: input.spy.timestamp,
      explanation: 'A recent spy provides the current estimate.',
      warnings: [],
      diagnostics: baseDiagnostics,
    }
  }

  const usable = observations.flatMap((observation) => {
    const bss = observation.top1000Capped
      ? null
      : estimateBssFromFairFight(observation.fairFight, observation.attackerBss)
    return bss === null
      ? []
      : [{ observation, bss, weight: observationWeight(observation, now) }]
  })
  const preliminaryMedian = usable.length
    ? weightedMedian(usable.map(({ bss, weight }) => ({ value: bss, weight })))
    : null
  const accepted =
    preliminaryMedian === null
      ? []
      : usable.filter(
          ({ bss }) =>
            Math.abs(bss - preliminaryMedian) / preliminaryMedian <=
            ESTIMATOR_CONFIG.outlierRelativeDistance,
        )
  const diagnostics = {
    ...baseDiagnostics,
    observationsAccepted: accepted.length,
    observationsRejected: observations.length - accepted.length,
  }

  if (accepted.length) {
    const bss = weightedMedian(
      accepted.map(({ bss: value, weight }) => ({ value, weight })),
    )
    const bssValues = accepted
      .map(({ bss: value }) => value)
      .sort((a, b) => a - b)
    const spread = percentile(bssValues, 0.9) - percentile(bssValues, 0.1)
    const factors = calibrationFactors(input.calibrationSamples ?? [])
    const mathematicalMinimum = (bss * bss) / 4
    let lowerBound = mathematicalMinimum * factors.low
    let upperBound = mathematicalMinimum * factors.high
    let rankConstraintUsed = false
    let evidenceConflict = false
    if (input.rankEvidence) {
      const rankLower = input.rankEvidence.lowerBound ?? 0
      const rankUpper =
        input.rankEvidence.upperBound ?? Number.POSITIVE_INFINITY
      if (rankUpper >= lowerBound && rankLower <= upperBound) {
        lowerBound = Math.max(lowerBound, rankLower)
        upperBound = Math.min(upperBound, rankUpper)
        rankConstraintUsed = true
      } else {
        evidenceConflict = true
      }
    }
    if (input.spy) {
      lowerBound = Math.max(lowerBound, input.spy.totalStats)
      if (lowerBound > upperBound) {
        upperBound = lowerBound
        evidenceConflict = true
      }
    }
    const agreement = bss === 0 ? 0 : 1 - Math.min(1, spread / bss)
    const exactAttackers = accepted.filter(
      ({ observation }) => observation.attackerStatsExact,
    ).length
    let confidence =
      ESTIMATOR_CONFIG.confidence.fairFightBase +
      accepted.length * ESTIMATOR_CONFIG.confidence.perAcceptedObservation +
      (exactAttackers ? ESTIMATOR_CONFIG.confidence.exactAttackerBonus : 0) +
      agreement * ESTIMATOR_CONFIG.confidence.agreementBonus +
      (rankConstraintUsed
        ? ESTIMATOR_CONFIG.confidence.rankAgreementBonus
        : 0) -
      (!factors.calibrated
        ? ESTIMATOR_CONFIG.confidence.uncalibratedPenalty
        : 0) -
      (evidenceConflict ? ESTIMATOR_CONFIG.confidence.conflictPenalty : 0)
    confidence = Math.round(Math.max(0, Math.min(99, confidence)))
    return {
      estimate: mathematicalMinimum * factors.median,
      lowerBound,
      upperBound,
      bss,
      confidence,
      confidenceLevel: confidenceLevel(confidence),
      sources: [
        'FAIR_FIGHT',
        ...(input.spy ? (['SPY'] as const) : []),
        ...(input.rankEvidence ? (['RANK'] as const) : []),
      ],
      newestEvidenceAt: newestTimestamp([
        ...accepted.map(({ observation }) => observation.timestamp),
        input.spy?.timestamp,
        input.rankEvidence?.timestamp,
      ]),
      explanation: `Weighted median of ${accepted.length} uncapped Fair Fight observation${accepted.length === 1 ? '' : 's'}, converted from BSS using ${factors.calibrated ? 'calibrated' : 'broad uncalibrated'} stat-distribution factors.`,
      warnings: [
        'Total battle stats depend on stat distribution.',
        ...(!factors.calibrated
          ? [
              'No sufficient calibration sample exists; the range is deliberately broad.',
            ]
          : []),
        ...(evidenceConflict
          ? [
              'Evidence conflicts with the Fair Fight estimate; confidence has been reduced.',
            ]
          : []),
      ],
      diagnostics: {
        ...diagnostics,
        weightedMedianBss: bss,
        bssSpread: spread,
        rankConstraintUsed,
        evidenceConflict,
      },
    }
  }

  if (input.spy) {
    const ageDays = spyAgeDays ?? 0
    const confidence = Math.round(
      Math.max(
        20,
        82 -
          Math.floor(ageDays / 90) *
            ESTIMATOR_CONFIG.confidence.oldSpyPenaltyPer90Days,
      ),
    )
    return {
      estimate: input.spy.totalStats,
      lowerBound: input.spy.totalStats,
      upperBound: ageDays > 30 ? null : input.spy.totalStats,
      bss: input.spy.individualStats
        ? calculateBattleStatScore(input.spy.individualStats)
        : null,
      confidence,
      confidenceLevel: confidenceLevel(confidence),
      sources: ['SPY'],
      newestEvidenceAt: input.spy.timestamp,
      explanation:
        ageDays > 30
          ? 'An older spy is shown as a historical lower bound, not a current exact value.'
          : 'A recent spy provides the current estimate.',
      warnings:
        ageDays > 30
          ? ['Battle stats may have increased since this spy was recorded.']
          : [],
      diagnostics,
    }
  }

  if (
    input.rankEvidence &&
    (input.rankEvidence.lowerBound !== undefined ||
      input.rankEvidence.upperBound !== undefined)
  ) {
    const lowerBound = input.rankEvidence.lowerBound ?? 0
    const upperBound = input.rankEvidence.upperBound ?? null
    return {
      estimate:
        upperBound === null ? lowerBound : (lowerBound + upperBound) / 2,
      lowerBound,
      upperBound,
      bss: null,
      confidence: ESTIMATOR_CONFIG.confidence.rankOnly,
      confidenceLevel: 'LOW',
      sources: ['RANK'],
      newestEvidenceAt: input.rankEvidence.timestamp,
      explanation:
        input.rankEvidence.description ??
        'Approximate rank-trigger constraint; rank is not a direct battle-stat measurement.',
      warnings: [
        'Rank triggers can be affected by level, crimes, net worth, and ghost ranks.',
      ],
      diagnostics,
    }
  }

  const weakEstimate = weakMetadataEstimate(input.weakMetadata)
  const hasCalibratedMetadata =
    input.weakMetadata?.age !== undefined &&
    input.weakMetadata.level !== undefined
  const weakLowerBound =
    weakEstimate === null
      ? null
      : weakEstimate *
        Math.pow(
          10,
          ESTIMATOR_CONFIG.metadataPrior.residualP10 -
            ESTIMATOR_CONFIG.metadataPrior.residualP50,
        )
  const weakUpperBound =
    weakEstimate === null
      ? null
      : weakEstimate *
        Math.pow(
          10,
          ESTIMATOR_CONFIG.metadataPrior.residualP90 -
            ESTIMATOR_CONFIG.metadataPrior.residualP50,
        )
  const displayEstimate =
    weakLowerBound === null || weakUpperBound === null
      ? weakEstimate
      : Math.round(((weakLowerBound + weakUpperBound) / 2) * 0.45)
  return {
    estimate: displayEstimate,
    lowerBound: weakLowerBound,
    upperBound: weakUpperBound,
    bss: null,
    confidence: weakEstimate === null ? 0 : hasCalibratedMetadata ? 18 : 5,
    confidenceLevel: 'LOW',
    sources: ['FALLBACK'],
    newestEvidenceAt: null,
    explanation:
      weakEstimate === null
        ? 'No reliable battle-stat evidence has been recorded for this player.'
        : hasCalibratedMetadata
          ? 'Age and level were compared with a 200-player calibration dataset; this remains a population estimate, not direct battle-stat evidence.'
          : 'A deliberately broad population prior is shown because no direct evidence is available; level does not reliably predict battle stats.',
    warnings: [
      'This is not a level-based battle-stat measurement and should not be used to plan an attack.',
    ],
    diagnostics,
  }
}

function weakMetadataEstimate(
  metadata: WeakMetadata | undefined,
): number | null {
  const level = metadata?.level
  if (!level || !Number.isFinite(level) || level < 1) return null
  if (!metadata.age || !Number.isFinite(metadata.age) || metadata.age < 1) {
    return Math.round(10_000 * Math.pow(level, 1.5))
  }
  const model = ESTIMATOR_CONFIG.metadataPrior
  const logTotal =
    model.intercept +
    model.logAge * Math.log10(metadata.age) +
    model.logLevel * Math.log10(level) +
    model.residualP50
  return Math.round(Math.pow(10, logTotal))
  /*
  // This only centres an explicitly 10,000×-wide, low-confidence prior.
  return Math.round(10_000 * Math.pow(level, 1.5))
  */
}

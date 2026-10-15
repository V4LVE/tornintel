// Battle stat evidence and estimates (TBS).

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
  // Set for an incoming attack: the known player was the defender and the
  // target whose stats we want was the attacker.
  defenderBss?: number
  attackerBalanceFactor?: number
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

export type WeakMetadata = { age?: number; level?: number; medals?: number }

export type BattleStatsEstimate = {
  estimate: number | null
  lowerBound: number | null
  upperBound: number | null
  bss: number | null
  confidence: number
  confidenceLevel: 'LOW' | 'MEDIUM' | 'HIGH' | 'VERY_HIGH'
  sources: Array<
    'EXACT' | 'SPY' | 'FAIR_FIGHT' | 'PROFILE' | 'RANK' | 'FALLBACK'
  >
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

export type SharedObservation = {
  evidenceId: string
  playerId: string
  sourcePlayerId: string
  sourcePlayerName?: string | null
  observation: FairFightObservation
}

export type BattleStatContributor = { id: string; name: string | null }

export type FairFightLoad = {
  evidence: SharedObservation[]
  observations: Map<string, FairFightObservation[]>
  status: 'READY' | 'NO_RECENT_FIGHTS' | 'UNAVAILABLE'
  reason?: string
}

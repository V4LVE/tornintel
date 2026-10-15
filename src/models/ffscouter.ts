// FF Scouter API responses and the estimates tornintel derives from them.

export type FfScouterErrorBody = { code?: number; error?: string }

export type FfScouterPlayerStats = {
  player_id: number
  fair_fight: number | null
  bs_estimate: number | null
  bs_estimate_human: string | null
  last_updated: number | null
}

export type FfScouterTarget = FfScouterPlayerStats & {
  name: string
  level: number
  last_action: number | null
  hospital_until?: number | null
}

export type FfScouterKeyStatus = { registered: boolean; premium: boolean }

export type FfScouterEstimate = {
  total: number
  human: string
  // Relative to the key owner; null when FF Scouter has no estimate.
  fairFight: number | null
  updatedAt: number | null
}

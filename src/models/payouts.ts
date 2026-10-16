// Ranked war payout data from /api/payout-hits.

export type PayoutPlayer = {
  id: string
  name: string
  warHits: number
  // Successful outside attacks that contributed to the faction chain during the war.
  nonWarHits: number
}

export type PayoutWar = { id: number; start: number; end: number }

// Without a war ID: the faction's last three ranked wars.
export type PayoutWarsResponse = { wars: PayoutWar[]; error?: string }

export type PayoutPlayersResponse = {
  war: { id: string }
  players: PayoutPlayer[]
  error?: string
}

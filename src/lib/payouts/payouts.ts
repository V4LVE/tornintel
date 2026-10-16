import type { PayoutPlayer } from '#/models/payouts'

export function calculatePayouts(
  players: PayoutPlayer[],
  earnings: number,
  warRate: number,
  outsideRate: number,
  includeOutside: boolean,
) {
  const budget = nonNegative(earnings)
  const requestedWarRate = nonNegative(warRate)
  const requestedOutsideRate = includeOutside ? nonNegative(outsideRate) : 0
  const warHits = players.reduce((sum, player) => sum + player.warHits, 0)
  const outsideHits = includeOutside
    ? players.reduce((sum, player) => sum + player.nonWarHits, 0)
    : 0
  const appliedOutsideRate = outsideHits
    ? Math.min(requestedOutsideRate, budget / outsideHits)
    : 0
  const remaining = Math.max(0, budget - outsideHits * appliedOutsideRate)
  const appliedWarRate = warHits
    ? Math.min(requestedWarRate, remaining / warHits)
    : 0
  const payouts = players.map((player) => ({
    ...player,
    amount: Math.floor(
      player.warHits * appliedWarRate +
        (includeOutside ? player.nonWarHits * appliedOutsideRate : 0),
    ),
  }))
  const total = payouts.reduce((sum, player) => sum + player.amount, 0)
  return {
    payouts,
    warHits,
    outsideHits,
    appliedWarRate,
    appliedOutsideRate,
    total,
    remainder: Math.max(0, budget - total),
    capped:
      warHits * requestedWarRate + outsideHits * requestedOutsideRate > budget,
  }
}

function nonNegative(value: number) {
  return Number.isFinite(value) ? Math.max(0, value) : 0
}

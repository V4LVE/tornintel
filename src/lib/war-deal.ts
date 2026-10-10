export type CacheEstimate = {
  name: string
  ours: number
  theirs: number
  price: number
}

export function summarizeDeal(
  ourScore: number,
  theirScore: number,
  caches: CacheEstimate[],
) {
  return {
    totalScore: ourScore + theirScore,
    lead: Math.abs(ourScore - theirScore),
    ourCaches: caches.reduce((sum, cache) => sum + cache.ours, 0),
    theirCaches: caches.reduce((sum, cache) => sum + cache.theirs, 0),
    ourValue: caches.reduce((sum, cache) => sum + cache.ours * cache.price, 0),
    theirValue: caches.reduce(
      (sum, cache) => sum + cache.theirs * cache.price,
      0,
    ),
  }
}

export const number = (value: number) =>
  value.toLocaleString('en-US', { maximumFractionDigits: 2 })
export const money = (value: number) => `$${number(value)}`

export function generateDealMessage(options: {
  ourName: string
  theirName: string
  winningScore: number
  losingScore: number
  weWin: boolean
  rate: number
  itemName: string
  itemValue: number
  paymentTiming: string
  offlineMinutes: number
  extraTerms: string
}) {
  const { winningScore, losingScore, weWin, rate, itemValue } = options
  const ours = options.ourName.trim() || 'NPC'
  const theirs = options.theirName.trim() || 'Your faction'
  const winner = weWin ? ours : theirs
  const loser = weWin ? theirs : ours
  const compensation = losingScore * rate
  const items = itemValue > 0 ? Math.floor(compensation / itemValue) : 0
  const remainder = itemValue > 0 ? compensation - items * itemValue : 0
  const compensationTerm =
    rate > 0 && itemValue > 0 && options.itemName.trim()
      ? `${loser} receives ${number(items)} ${options.itemName.trim()}${remainder > 0 ? ` plus ${money(remainder)} cash for rounding` : ''}, based on ${money(rate)} per war score point actually scored by the losing faction (item valuation: ${money(itemValue)} each). At ${number(losingScore)} score, the planned compensation is ${money(compensation)}.`
      : rate > 0
        ? `${loser} receives compensation worth ${money(rate)} per war score point actually scored by the losing faction. At ${number(losingScore)} score, the planned compensation is ${money(compensation)}. Item type and valuation to be agreed before the war.`
        : ''
  const paymentTerms = [
    compensationTerm,
    options.paymentTiming.trim()
      ? `Payment: ${options.paymentTiming.trim()}, using the final war report to confirm the score.`
      : '',
  ]
    .filter(Boolean)
    .map((term) => `\n• ${term}`)
    .join('')

  return `Hey! 👋

Would you be interested in a deal for the upcoming war so we can both earn a buck and keep it easy for everyone?

⚔️ Proposed scores:
${ours}: ${number(weWin ? winningScore : losingScore)}
${theirs}: ${number(weWin ? losingScore : winningScore)}
${winner} takes the win.

📋 Proposed terms:
• Attack offliners only (offline for at least ${number(options.offlineMinutes)} minutes); avoid online and idle players.
• Med out when possible on mutually agreed med-out partners; coordinate availability beforehand.
• No mugs, outside hitters, or unagreed score pushes. Coordinate chain bonuses and pause near the agreed scores to avoid ending the war early.${paymentTerms}
• Confirm the score targets against the net lead required to end the war; agree any changes with both leaders first.${options.extraTerms.trim() ? `\n• ${options.extraTerms.trim()}` : ''}

Keeps the war straightforward, gets both factions some decent score, and hopefully leaves everyone better off. 💰

Let me know if you're interested. We can confirm the scores, ${paymentTerms ? 'compensation, ' : ''}med-out partners, and terms before the war starts. 👍`
}

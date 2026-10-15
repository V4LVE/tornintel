import type {
  BattleStatContributor,
  BattleStatsEstimate,
} from '#/models/battle-stats'

// Sorts by the point estimate, falling back to a known bound; unknown sorts last.
export function battleStatsSortValue(
  estimate: BattleStatsEstimate | undefined,
) {
  return (
    estimate?.estimate ?? estimate?.lowerBound ?? estimate?.upperBound ?? null
  )
}

// Shared by the war hospital target list and the levelling list.
export function BattleStatsCell({
  estimate,
  contributors = [],
}: {
  estimate: BattleStatsEstimate
  contributors?: BattleStatContributor[]
}) {
  const contributorNames = contributors
    .map((contributor) => contributor.name || contributor.id)
    .join(', ')
  const evidenceDetails =
    estimate.newestEvidenceAt === null ? null : (
      <span title={`Contributed by: ${contributorNames}`}>
        Recorded · {new Date(estimate.newestEvidenceAt).toLocaleDateString()}
        {contributors.length > 0 && ` · by ${contributorNames}`}
      </span>
    )
  if (estimate.estimate === null) {
    const cappedBound = estimate.sources.includes('FAIR_FIGHT')
      ? estimate.lowerBound !== null && estimate.lowerBound > 0
        ? `${formatBattleStats(estimate.lowerBound)}+`
        : estimate.upperBound !== null
          ? `≤${formatBattleStats(estimate.upperBound)}`
          : null
      : null
    return (
      <div className="battle-stats" title={estimate.explanation}>
        <strong>{cappedBound ?? 'No usable FF'}</strong>
        <span className="battle-stats-method">
          {cappedBound ? 'Capped FF · bound only' : 'No recent FF evidence'}
        </span>
        {evidenceDetails}
      </div>
    )
  }

  const range =
    estimate.upperBound !== null && estimate.lowerBound === estimate.upperBound
      ? formatBattleStats(estimate.estimate)
      : estimate.upperBound === null &&
          estimate.estimate === estimate.lowerBound
        ? `${formatBattleStats(estimate.lowerBound)}+`
        : `~${formatBattleStats(estimate.estimate)}`
  const bounds = estimate.sources.includes('FALLBACK')
    ? null
    : estimate.upperBound === null && estimate.estimate === estimate.lowerBound
      ? null
      : estimate.upperBound === null
        ? `${formatBattleStats(estimate.lowerBound ?? 0)}+`
        : estimate.lowerBound === estimate.upperBound
          ? null
          : `${formatBattleStats(estimate.lowerBound ?? 0)}–${formatBattleStats(estimate.upperBound)}`
  const method = estimate.sources.includes('EXACT')
    ? 'Exact stats'
    : estimate.sources.includes('SPY') &&
        !estimate.sources.includes('FAIR_FIGHT')
      ? 'Spy estimate'
      : estimate.sources.includes('FAIR_FIGHT')
        ? estimate.diagnostics.observationsAccepted > 0
          ? `FF-based · ${estimate.diagnostics.observationsAccepted} hit${estimate.diagnostics.observationsAccepted === 1 ? '' : 's'}`
          : 'Capped FF bound'
        : estimate.sources.includes('FALLBACK')
          ? 'Profile estimate · FF not used'
          : 'Rank estimate'
  return (
    <div className="battle-stats" title={estimate.explanation}>
      <strong>{range}</strong>
      <span className="battle-stats-method">{method}</span>
      {evidenceDetails}
      <span>
        {bounds ? `${bounds} · ` : ''}
        {estimate.bss === null ? '' : `BSS ${Math.round(estimate.bss)} · `}
        {estimate.confidenceLevel.replace('_', ' ')}
      </span>
    </div>
  )
}

function formatBattleStats(value: number) {
  if (value >= 1_000_000_000) return `${(value / 1_000_000_000).toFixed(1)}b`
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}m`
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}k`
  return Math.round(value).toLocaleString()
}

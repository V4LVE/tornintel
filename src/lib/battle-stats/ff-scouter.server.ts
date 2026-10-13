import type { FfScouterEstimate } from './my-stats'

type FfScouterTarget = {
  player_id?: number
  fair_fight?: number | null
  bs_estimate?: number | null
  bs_estimate_human?: string | null
  last_updated?: number | null
}

const MAX_TARGETS = 205

// FF Scouter needs the viewer's Torn key to be registered on ffscouter.com.
export async function fetchFfScouterEstimates(
  apiKey: string,
  playerIds: string[],
): Promise<{ estimates: Map<string, FfScouterEstimate>; reason?: string }> {
  const estimates = new Map<string, FfScouterEstimate>()
  try {
    for (let start = 0; start < playerIds.length; start += MAX_TARGETS) {
      const url = new URL('https://ffscouter.com/api/v1/get-stats')
      url.searchParams.set('key', apiKey)
      url.searchParams.set(
        'targets',
        playerIds.slice(start, start + MAX_TARGETS).join(','),
      )
      const response = await fetch(url, {
        cache: 'no-store',
        signal: AbortSignal.timeout(15000),
      })
      const payload = (await response.json().catch(() => null)) as
        FfScouterTarget[] | { code?: number; error?: string } | null
      if (!Array.isArray(payload)) {
        const code = payload && 'code' in payload ? payload.code : undefined
        return {
          estimates,
          reason:
            code === 6 || code === 2
              ? 'FF Scouter does not recognise your key. Register it at ffscouter.com to see estimates.'
              : `FF Scouter estimates are unavailable${payload && 'error' in payload && payload.error ? `: ${payload.error}` : ` (HTTP ${response.status})`}.`,
        }
      }
      for (const target of payload) {
        if (!target.player_id) continue
        estimates.set(String(target.player_id), {
          total: target.bs_estimate ?? null,
          human: target.bs_estimate_human ?? null,
          fairFight: target.fair_fight ?? null,
          updatedAt: target.last_updated ?? null,
        })
      }
    }
    return { estimates }
  } catch (error) {
    console.warn('[tornintel] FF Scouter request failed', {
      message: error instanceof Error ? error.message : String(error),
    })
    return { estimates, reason: 'FF Scouter could not be reached.' }
  }
}

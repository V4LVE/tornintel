import { createFileRoute } from '@tanstack/react-router'
import { fetchTorn } from '#/lib/torn/torn-api.server'
import {
  HISTORIC_STAT_QUERY,
  parsePersonalStats,
} from '#/lib/battle-stats/my-stats'
import { myStatsErrorResponse } from '#/lib/battle-stats/my-stats.server'
import { recordSharedStats } from '#/lib/battle-stats/faction-sharing.server'

type TornPersonalStatsResponse = {
  personalstats?: { name: string; value: number }[]
}

// Past readings never change, so they can be reused for a day.
const HISTORY_MAX_AGE_MS = 24 * 60 * 60 * 1000

export const Route = createFileRoute('/api/(my-stats)/my-stats-history')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const apiKey = request.headers.get('x-torn-api-key')?.trim()
        if (!apiKey) {
          return Response.json(
            { error: 'Enter your Torn API key to continue.' },
            { status: 401 },
          )
        }

        const raw = new URL(request.url).searchParams.get('timestamp') ?? ''
        const timestamp = Number(raw)
        if (
          !/^\d{1,10}$/.test(raw) ||
          timestamp <= 0 ||
          timestamp > Date.now() / 1000
        ) {
          return Response.json(
            { error: 'Enter a past unix timestamp.' },
            { status: 400 },
          )
        }

        const url = new URL('https://api.torn.com/v2/user/personalstats')
        url.searchParams.set('stat', HISTORIC_STAT_QUERY)
        url.searchParams.set('timestamp', String(timestamp))
        url.searchParams.set('key', apiKey)

        try {
          const { data } = await fetchTorn<TornPersonalStatsResponse>(url, {
            maxAgeMs: HISTORY_MAX_AGE_MS,
          })
          const point = parsePersonalStats(data.personalstats, timestamp)
          if (point) await recordSharedStats(apiKey, [point])
          return Response.json(
            { point },
            { headers: { 'Cache-Control': 'no-store' } },
          )
        } catch (error) {
          console.error('[tornintel] Stat history fetch failed', {
            message: error instanceof Error ? error.message : String(error),
          })
          return myStatsErrorResponse(error)
        }
      },
    },
  },
})

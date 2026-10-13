import { createFileRoute } from '@tanstack/react-router'
import { fetchTorn } from '#/lib/torn/torn-api.server'
import { myStatsErrorResponse } from '#/lib/battle-stats/my-stats.server'
import { recordSharedStats } from '#/lib/battle-stats/faction-sharing.server'
import { toStatPoint } from '#/lib/battle-stats/my-stats'
import type { MyStatsResponse } from '#/models/my-stats'
import type { TornOwnStatsResponse } from '#/models/torn'

export const Route = createFileRoute('/api/(my-stats)/my-stats')({
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

        const url = new URL('https://api.torn.com/v2/user')
        url.searchParams.set('selections', 'basic,battlestats')
        url.searchParams.set('key', apiKey)

        try {
          const { data: payload, fetchedAt } =
            await fetchTorn<TornOwnStatsResponse>(url, { maxAgeMs: 30000 })
          const { profile, battlestats } = payload
          if (
            !profile?.id ||
            !profile.name ||
            !battlestats ||
            !Number.isFinite(battlestats.total)
          ) {
            return Response.json(
              { error: 'Torn returned incomplete battle stats.' },
              { status: 502 },
            )
          }

          await recordSharedStats(apiKey, [
            {
              ...toStatPoint(battlestats, fetchedAt / 1000),
              observedAt: fetchedAt / 1000,
            },
          ])
          return Response.json(
            {
              profile: {
                id: profile.id,
                name: profile.name,
                level: profile.level ?? 0,
              },
              battlestats,
              fetchedAt,
            } satisfies MyStatsResponse,
            { headers: { 'Cache-Control': 'no-store' } },
          )
        } catch (error) {
          console.error('[tornintel] My stats fetch failed', {
            message: error instanceof Error ? error.message : String(error),
          })
          return myStatsErrorResponse(error)
        }
      },
    },
  },
})

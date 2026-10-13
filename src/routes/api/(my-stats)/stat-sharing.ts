import { createFileRoute } from '@tanstack/react-router'
import { fetchTorn } from '#/lib/torn/torn-api.server'
import {
  fetchPlayerIdentity,
  recordSharedStats,
  statSharingRepository,
} from '#/lib/battle-stats/faction-sharing.server'
import { myStatsErrorResponse } from '#/lib/battle-stats/my-stats.server'
import { toStatPoint } from '#/lib/battle-stats/my-stats'
import type { OwnBattleStats, StatSharingResponse } from '#/models/my-stats'

const noStore = { 'Cache-Control': 'no-store' }

function requireSetup(request: Request) {
  const apiKey = request.headers.get('x-torn-api-key')?.trim()
  if (!apiKey)
    return {
      error: Response.json(
        { error: 'Enter your Torn API key to continue.' },
        { status: 401 },
      ),
    }
  if (!process.env.DATABASE_URL)
    return {
      error: Response.json(
        { error: 'Stat sharing needs a database. Set DATABASE_URL.' },
        { status: 503 },
      ),
    }
  return { apiKey }
}

export const Route = createFileRoute('/api/(my-stats)/stat-sharing')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const { apiKey, error } = requireSetup(request)
        if (error) return error
        try {
          const identity = await fetchPlayerIdentity(apiKey)
          return Response.json(
            {
              isSharing: await statSharingRepository.isSharing(identity.id),
              factionName: identity.factionName,
            } satisfies StatSharingResponse,
            { headers: noStore },
          )
        } catch (requestError) {
          return myStatsErrorResponse(requestError)
        }
      },
      POST: async ({ request }) => {
        const { apiKey, error } = requireSetup(request)
        if (error) return error
        const body = (await request.json().catch(() => null)) as {
          enabled?: unknown
        } | null
        if (typeof body?.enabled !== 'boolean') {
          return Response.json(
            { error: 'Send { "enabled": true } or { "enabled": false }.' },
            { status: 400 },
          )
        }

        try {
          const identity = await fetchPlayerIdentity(apiKey)
          if (!body.enabled) {
            await statSharingRepository.disable(identity.id)
            return Response.json(
              { isSharing: false } satisfies StatSharingResponse,
              {
                headers: noStore,
              },
            )
          }
          if (!identity.factionId) {
            return Response.json(
              { error: 'Join a faction before sharing your stats.' },
              { status: 409 },
            )
          }

          // Reading the stats first proves the key can see them.
          const url = new URL('https://api.torn.com/v2/user')
          url.searchParams.set('selections', 'battlestats')
          url.searchParams.set('key', apiKey)
          const { data, fetchedAt } = await fetchTorn<{
            battlestats?: OwnBattleStats
          }>(url, { maxAgeMs: 30000 })
          if (!data.battlestats || !Number.isFinite(data.battlestats.total)) {
            return Response.json(
              { error: 'Torn returned incomplete battle stats.' },
              { status: 502 },
            )
          }

          await statSharingRepository.enable({
            ...identity,
            factionId: identity.factionId,
          })
          await recordSharedStats(
            apiKey,
            [
              {
                ...toStatPoint(data.battlestats, fetchedAt / 1000),
                observedAt: fetchedAt / 1000,
              },
            ],
            identity,
          )
          return Response.json(
            { isSharing: true } satisfies StatSharingResponse,
            {
              headers: noStore,
            },
          )
        } catch (requestError) {
          console.error('[tornintel] Stat sharing update failed', {
            message:
              requestError instanceof Error
                ? requestError.message
                : String(requestError),
          })
          return myStatsErrorResponse(requestError)
        }
      },
    },
  },
})

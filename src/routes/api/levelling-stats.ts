import { createFileRoute } from '@tanstack/react-router'
import { estimateBattleStats } from '#/lib/battle-stats/estimator'
import { loadFairFightEvidence } from '#/lib/battle-stats/fair-fight-evidence.server'
import { syncSharedEvidence } from '#/lib/battle-stats/shared-evidence.server'
import type { LevellingStatsResponse } from '#/lib/levelling'

const headers = { 'Cache-Control': 'no-store' }
// Enough for the largest tier, including players added in tornintel.
const MAX_IDS = 600

export const Route = createFileRoute('/api/levelling-stats')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const apiKey = request.headers.get('x-torn-api-key')?.trim()
        if (!apiKey) {
          return Response.json(
            { error: 'Enter your Torn API key to load battle stat estimates.' },
            { status: 401, headers },
          )
        }
        const ids = [
          ...new Set(
            (new URL(request.url).searchParams.get('ids') ?? '')
              .split(',')
              .filter((id) => /^\d{1,10}$/.test(id)),
          ),
        ]
        if (!ids.length || ids.length > MAX_IDS) {
          return Response.json(
            { error: `Request estimates for 1 to ${MAX_IDS} players.` },
            { status: 400, headers },
          )
        }

        // Same evidence flow as the war hospital: the viewer's recent fights are
        // shared, then combined with fights other tornintel users recorded.
        const now = Date.now()
        const ownEvidence = await loadFairFightEvidence(apiKey, now)
        const shared = await syncSharedEvidence(ownEvidence.evidence, ids)
        const stats: LevellingStatsResponse['stats'] = {}
        for (const id of ids) {
          const observations = shared.observations.get(id)
          if (!observations?.length) continue
          stats[id] = {
            battleStats: estimateBattleStats({
              now,
              fairFightObservations: observations,
            }),
            contributors: shared.contributors.get(id) ?? [],
          }
        }
        return Response.json(
          {
            stats,
            fairFightReason: ownEvidence.reason,
            sharedTbsReason: shared.reason,
          } satisfies LevellingStatsResponse,
          { headers },
        )
      },
    },
  },
})

import { createFileRoute } from '@tanstack/react-router'
import {
  ffScouter,
  ffScouterErrorResponse,
  ffScouterKeyFrom,
} from '#/lib/ffscouter/ffscouter.server'
import type { LevellingEstimatesResponse } from '#/models/levelling'

const headers = { 'Cache-Control': 'no-store' }
// Enough for the largest tier, including players added in tornintel.
const MAX_IDS = 410

export const Route = createFileRoute('/api/(levelling)/levelling-estimates')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const apiKey = ffScouterKeyFrom(request)
        if (!apiKey) {
          return Response.json(
            {
              error:
                'Enter a Torn or FF Scouter API key to load FF Scouter estimates.',
            },
            { status: 401, headers },
          )
        }
        const ids = (new URL(request.url).searchParams.get('ids') ?? '')
          .split(',')
          .map(Number)
          .filter((id) => Number.isInteger(id) && id > 0)
        if (!ids.length || ids.length > MAX_IDS) {
          return Response.json(
            { error: `Request estimates for 1 to ${MAX_IDS} players.` },
            { status: 400, headers },
          )
        }

        try {
          const estimates = await ffScouter.getEstimates(apiKey, ids)
          return Response.json(
            {
              estimates: Object.fromEntries(estimates),
            } satisfies LevellingEstimatesResponse,
            { headers },
          )
        } catch (error) {
          return ffScouterErrorResponse(error)
        }
      },
    },
  },
})

import { createFileRoute } from '@tanstack/react-router'
import {
  ffScouter,
  ffScouterErrorResponse,
  ffScouterKeyFrom,
} from '#/lib/ffscouter/ffscouter.server'
import { isLevellingTier, LEVELLING_TIERS } from '#/lib/levelling/levelling'
import { loadLevellingPlayers } from '#/lib/levelling/levelling.server'
import type { LevellingDiscoverResponse } from '#/models/levelling'

const headers = { 'Cache-Control': 'no-store' }

export const Route = createFileRoute('/api/(levelling)/levelling-discover')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const apiKey = ffScouterKeyFrom(request)
        if (!apiKey) {
          return Response.json(
            {
              error: 'Enter a Torn or FF Scouter API key to find new players.',
            },
            { status: 401, headers },
          )
        }
        const params = new URL(request.url).searchParams
        const tier = params.get('tier')
        const maxFairFight = Number(params.get('maxff') ?? '1.5')
        if (
          !isLevellingTier(tier) ||
          !Number.isFinite(maxFairFight) ||
          maxFairFight < 1 ||
          maxFairFight > 3
        ) {
          return Response.json(
            { error: 'Choose a tier and a fair fight limit from 1 to 3.' },
            { status: 400, headers },
          )
        }

        try {
          const { min, max } = LEVELLING_TIERS[tier]
          const [found, { players: listed }] = await Promise.all([
            ffScouter.findTargets(apiKey, {
              minLevel: min,
              maxLevel: max,
              maxFairFight,
              inactiveOnly: params.get('inactive') !== '0',
            }),
            loadLevellingPlayers(),
          ])
          const listedIds = new Set(listed.map((player) => player.id))
          const players = found
            .map((player) => ({ ...player, onList: listedIds.has(player.id) }))
            // Weakest first; players without an estimate go last.
            .sort(
              (a, b) =>
                (a.estimate?.total ?? Infinity) -
                (b.estimate?.total ?? Infinity),
            )
          return Response.json(
            { players } satisfies LevellingDiscoverResponse,
            { headers },
          )
        } catch (error) {
          return ffScouterErrorResponse(error)
        }
      },
    },
  },
})

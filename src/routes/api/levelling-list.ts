import { createFileRoute } from '@tanstack/react-router'
import { ffScouter, ffScouterKeyFrom } from '#/lib/ffscouter.server'
import { LEVELLING_TIERS } from '#/lib/levelling'
import type { LevellingListResponse } from '#/lib/levelling'
import {
  levellingListRepository,
  loadLevellingPlayers,
} from '#/lib/levelling.server'
import { fetchTorn, TornApiError } from '#/lib/torn-api.server'

type BasicProfile = {
  player_id?: number
  name?: string
  level?: number
}

const headers = { 'Cache-Control': 'no-store' }
const MIN_LEVEL = Math.min(
  ...Object.values(LEVELLING_TIERS).map((tier) => tier.min),
)
const MAX_LEVEL = Math.max(
  ...Object.values(LEVELLING_TIERS).map((tier) => tier.max),
)

export const Route = createFileRoute('/api/levelling-list')({
  server: {
    handlers: {
      GET: async () => {
        const { players, warning } = await loadLevellingPlayers()
        return Response.json(
          { players, warning } satisfies LevellingListResponse,
          { headers },
        )
      },
      POST: async ({ request }) => {
        const apiKey = request.headers.get('x-torn-api-key')?.trim()
        if (!apiKey) {
          return Response.json(
            { error: 'Enter your Torn API key to change the list.' },
            { status: 401, headers },
          )
        }
        const body = (await request.json().catch(() => null)) as {
          playerId?: unknown
          action?: unknown
        } | null
        const playerId = Number(body?.playerId)
        const action = body?.action
        if (
          !Number.isInteger(playerId) ||
          playerId <= 0 ||
          (action !== 'add' && action !== 'remove')
        ) {
          return Response.json(
            { error: 'Choose a player to add or remove.' },
            { status: 400, headers },
          )
        }
        if (!process.env.DATABASE_URL) {
          return Response.json(
            { error: 'Shared list storage is not configured on this server.' },
            { status: 503, headers },
          )
        }

        try {
          // Record who made the change from Torn, never from the request body.
          const editor = await loadBasic(apiKey)
          if (!editor.player_id || !editor.name) {
            throw new Error('Torn returned an incomplete profile.')
          }
          const { players } = await loadLevellingPlayers()
          const current = players.find((player) => player.id === playerId)

          if (action === 'remove') {
            if (!current) {
              return Response.json(
                { error: 'That player is not on the list.' },
                { status: 404, headers },
              )
            }
            await levellingListRepository.save({
              playerId,
              name: current.name,
              level: current.level,
              totalEstimate: current.str === null ? current.total : null,
              removed: true,
              addedById: current.addedBy?.id ?? null,
              addedByName: current.addedBy?.name ?? null,
              changedById: editor.player_id,
            })
          } else {
            if (current) {
              return Response.json(
                { error: 'That player is already on the list.' },
                { status: 409, headers },
              )
            }
            const target = await loadBasic(apiKey, playerId)
            if (
              target.player_id !== playerId ||
              !target.name ||
              !target.level
            ) {
              return Response.json(
                { error: 'Torn could not find that player.' },
                { status: 404, headers },
              )
            }
            if (target.level < MIN_LEVEL || target.level > MAX_LEVEL) {
              return Response.json(
                {
                  error: `Only players from level ${MIN_LEVEL} to ${MAX_LEVEL} can be added.`,
                },
                { status: 400, headers },
              )
            }
            // The estimate is a helpful snapshot; adding works without it.
            const estimates = await ffScouter
              .getEstimates(ffScouterKeyFrom(request), [playerId])
              .catch(() => null)
            await levellingListRepository.save({
              playerId,
              name: target.name,
              level: target.level,
              totalEstimate: estimates?.get(playerId)?.total ?? null,
              removed: false,
              addedById: editor.player_id,
              addedByName: editor.name,
              changedById: editor.player_id,
            })
          }

          const updated = await loadLevellingPlayers()
          return Response.json(
            {
              players: updated.players,
              warning: updated.warning,
            } satisfies LevellingListResponse,
            { headers },
          )
        } catch (error) {
          console.error('[tornintel] Levelling list change failed', {
            message: error instanceof Error ? error.message : String(error),
          })
          return Response.json(
            {
              error:
                error instanceof TornApiError
                  ? error.message
                  : 'The list could not be changed right now. Try again shortly.',
            },
            {
              status: error instanceof TornApiError && error.code ? 401 : 502,
              headers,
            },
          )
        }
      },
    },
  },
})

async function loadBasic(apiKey: string, id?: number) {
  const url = new URL(`https://api.torn.com/user/${id ?? ''}`)
  url.searchParams.set('selections', 'basic')
  url.searchParams.set('key', apiKey)
  try {
    const { data } = await fetchTorn<BasicProfile>(url, { maxAgeMs: 60000 })
    return data
  } catch (error) {
    // Torn reports an unknown player ID as code 6; treat it as not found.
    if (id && error instanceof TornApiError && error.code === 6) return {}
    throw error
  }
}

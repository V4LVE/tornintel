import { createFileRoute } from '@tanstack/react-router'
import { ffScouter, ffScouterKeyFrom } from '#/lib/ffscouter.server'
import { LEVELLING_TIERS } from '#/lib/levelling'
import type { LevellingListResponse } from '#/lib/levelling'
import {
  isLevellingEditor,
  levellingListRepository,
  loadLevellingPlayers,
} from '#/lib/levelling.server'
import { fetchTorn, TornApiError } from '#/lib/torn-api.server'

type BasicProfile = {
  player_id?: number
  name?: string
  level?: number
}

type EditorProfile = BasicProfile & { faction?: { faction_id?: number } }

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
      GET: async ({ request }) => {
        const apiKey = request.headers.get('x-torn-api-key')?.trim()
        const [{ players, warning }, canEdit] = await Promise.all([
          loadLevellingPlayers(),
          // The list is public; a key only reveals whether the viewer may edit.
          apiKey
            ? loadEditor(apiKey).then(
                (editor) => editor.canEdit,
                () => false,
              )
            : false,
        ])
        return Response.json(
          { players, canEdit, warning } satisfies LevellingListResponse,
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
          const editor = await loadEditor(apiKey)
          const { players, removedIds } = await loadLevellingPlayers()
          const current = players.find((player) => player.id === playerId)

          if (action === 'remove') {
            if (!editor.canEdit) {
              return Response.json(
                {
                  error:
                    'Only trusted editors can remove players from the shared list.',
                },
                { status: 403, headers },
              )
            }
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
              changedById: editor.id,
            })
          } else {
            if (current) {
              return Response.json(
                { error: 'That player is already on the list.' },
                { status: 409, headers },
              )
            }
            // Otherwise anyone could undo an editor's removal by adding it back.
            if (removedIds.has(playerId) && !editor.canEdit) {
              return Response.json(
                {
                  error:
                    'A trusted editor removed this player. Only editors can restore them.',
                },
                { status: 403, headers },
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
              addedById: editor.id,
              addedByName: editor.name,
              changedById: editor.id,
            })
          }

          const updated = await loadLevellingPlayers()
          return Response.json(
            {
              players: updated.players,
              canEdit: editor.canEdit,
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

async function loadEditor(apiKey: string) {
  const url = new URL('https://api.torn.com/user/')
  url.searchParams.set('selections', 'profile')
  url.searchParams.set('key', apiKey)
  const { data } = await fetchTorn<EditorProfile>(url, { maxAgeMs: 60000 })
  if (!data.player_id || !data.name) {
    throw new Error('Torn returned an incomplete profile.')
  }
  const editor = {
    id: data.player_id,
    name: data.name,
    factionId: data.faction?.faction_id || null,
  }
  return { ...editor, canEdit: isLevellingEditor(editor) }
}

async function loadBasic(apiKey: string, id: number) {
  const url = new URL(`https://api.torn.com/user/${id}`)
  url.searchParams.set('selections', 'basic')
  url.searchParams.set('key', apiKey)
  try {
    const { data } = await fetchTorn<BasicProfile>(url, { maxAgeMs: 60000 })
    return data
  } catch (error) {
    // Torn reports an unknown player ID as code 6; treat it as not found.
    if (error instanceof TornApiError && error.code === 6) return {}
    throw error
  }
}

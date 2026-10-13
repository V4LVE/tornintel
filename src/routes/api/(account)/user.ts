import { createFileRoute } from '@tanstack/react-router'
import { fetchTorn, TornApiError } from '#/lib/torn-api.server'

type TornUserResponse = {
  player_id?: number
  name?: string
  level?: number
  faction?: { faction_id?: number; faction_name?: string }
  error?: { error: string; code: number }
}

export const Route = createFileRoute('/api/user')({
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

        const url = new URL('https://api.torn.com/user/')
        url.searchParams.set('selections', '')
        url.searchParams.set('key', apiKey)

        try {
          const { data: user } = await fetchTorn<TornUserResponse>(url, {
            maxAgeMs: 60000,
          })
          if (user.error) {
            return Response.json({ error: user.error.error }, { status: 401 })
          }

          if (!user.player_id || !user.name) {
            return Response.json(
              { error: 'Torn returned an incomplete user profile.' },
              { status: 502 },
            )
          }

          return Response.json(
            {
              user: {
                id: user.player_id,
                name: user.name,
                level: user.level ?? 0,
                factionName: user.faction?.faction_name ?? 'No faction',
              },
            },
            { headers: { 'Cache-Control': 'no-store' } },
          )
        } catch (error) {
          console.error('[tornintel] User fetch failed', {
            message: error instanceof Error ? error.message : String(error),
          })
          return Response.json(
            {
              error:
                error instanceof TornApiError
                  ? error.message
                  : 'Unable to reach Torn right now. Try again shortly.',
            },
            { status: error instanceof TornApiError && error.code ? 401 : 502 },
          )
        }
      },
    },
  },
})

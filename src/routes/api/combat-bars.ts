import { createFileRoute } from '@tanstack/react-router'

type TornBar = {
  current: number
  maximum: number
  increment: number
  interval: number
  tick_time: number
  full_time: number
}

type TornChain = {
  current: number
  max: number
  timeout: number
  cooldown: number
}

type TornBarsResponse = {
  bars?: { energy?: TornBar; chain?: TornChain | null }
  error?: { code: number; error: string }
}

export const Route = createFileRoute('/api/combat-bars')({
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

        const url = new URL('https://api.torn.com/v2/user/bars')
        url.searchParams.set('key', apiKey)

        try {
          const response = await fetch(url, { cache: 'no-store' })
          if (!response.ok)
            throw new Error(`Torn returned HTTP ${response.status}`)
          const payload = (await response.json()) as TornBarsResponse
          if (payload.error) {
            return Response.json(
              { error: payload.error.error },
              { status: 502 },
            )
          }
          const energy = payload.bars?.energy
          if (
            !energy ||
            !Number.isFinite(energy.current) ||
            !Number.isFinite(energy.maximum)
          ) {
            return Response.json(
              { error: 'Torn returned incomplete bar data.' },
              { status: 502 },
            )
          }

          return Response.json(
            {
              energy,
              chain: payload.bars?.chain ?? null,
              fetchedAt: Date.now(),
            },
            { headers: { 'Cache-Control': 'no-store' } },
          )
        } catch (error) {
          console.error('[tornintel] Combat bars fetch failed', {
            message: error instanceof Error ? error.message : String(error),
          })
          return Response.json(
            {
              error: 'Unable to load your energy and chain. Try again shortly.',
            },
            { status: 502 },
          )
        }
      },
    },
  },
})

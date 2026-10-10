import { createFileRoute } from '@tanstack/react-router'
import { loadDealDefaults } from '#/lib/war-deal-data.server'

export const Route = createFileRoute('/api/war-deal-defaults')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const key = request.headers.get('x-torn-api-key')?.trim()
        if (!key)
          return Response.json(
            {
              error:
                'Connect a Torn API key in Settings to load war details and prices.',
            },
            { status: 401 },
          )
        const opponent = new URL(request.url).searchParams.get('opponentId')
        if (
          opponent &&
          (!/^\d+$/.test(opponent) ||
            !Number.isSafeInteger(Number(opponent)) ||
            Number(opponent) <= 0)
        ) {
          return Response.json(
            { error: 'Enter a valid opponent faction ID.' },
            { status: 400 },
          )
        }
        try {
          return Response.json(
            await loadDealDefaults(
              key,
              opponent ? Number(opponent) : undefined,
            ),
            { headers: { 'Cache-Control': 'no-store' } },
          )
        } catch (error) {
          return Response.json(
            {
              error:
                error instanceof Error
                  ? error.message
                  : 'Could not load Torn data.',
            },
            { status: 502 },
          )
        }
      },
    },
  },
})

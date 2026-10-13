import { createFileRoute } from '@tanstack/react-router'
import {
  ffScouter,
  ffScouterErrorResponse,
} from '#/lib/ffscouter/ffscouter.server'

const headers = { 'Cache-Control': 'no-store' }

export const Route = createFileRoute('/api/(account)/ffscouter-key')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const key = request.headers.get('x-ffscouter-key')?.trim()
        if (!key || !/^[A-Za-z0-9]{16}$/.test(key)) {
          return Response.json(
            { error: 'An FF Scouter key is 16 letters and digits.' },
            { status: 400, headers },
          )
        }
        try {
          return Response.json(await ffScouter.checkKey(key), { headers })
        } catch (error) {
          return ffScouterErrorResponse(error)
        }
      },
    },
  },
})

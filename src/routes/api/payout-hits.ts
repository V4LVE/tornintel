import { createFileRoute } from '@tanstack/react-router'
import { fetchTorn } from '#/lib/torn-api.server'

type Player = { id: string; name: string; warHits: number; nonWarHits: number }
type Attack = {
  attacker?: { id?: number; name?: string }
  is_ranked_war?: boolean
}
type RankedReport = {
  rankedwarreport?: {
    start?: number
    end?: number
    factions?: Array<{
      id?: number
      members?: Record<string, { name?: string; attacks?: number }>
    }>
  }
}

export const Route = createFileRoute('/api/payout-hits')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const key = request.headers.get('x-torn-api-key')?.trim()
        if (!key)
          return Response.json(
            { error: 'A Torn API key is required.' },
            { status: 401 },
          )
        const warId = new URL(request.url).searchParams.get('warId')
        try {
          if (!warId) {
            const history = (await torn(
              '/v2/faction/rankedwars?limit=3',
              key,
            )) as {
              rankedwars?: Array<{ id: number; start: number; end: number }>
            }
            return Response.json({
              wars: (history.rankedwars ?? []).slice(0, 3),
            })
          }
          if (!/^\d+$/.test(warId))
            return Response.json({ error: 'Invalid war ID.' }, { status: 400 })
          const [report, account] = await Promise.all([
            torn(
              `/v2/faction/${warId}/rankedwarreport`,
              key,
            ) as Promise<RankedReport>,
            tornV1Account(key),
          ])
          const war = report.rankedwarreport
          const own = war?.factions?.find(
            (faction) =>
              String(faction.id) === String(account.faction?.faction_id),
          )
          if (!war || !own)
            throw new Error(
              'Could not identify your faction in this war report.',
            )
          const players = new Map<string, Player>()
          for (const [id, member] of Object.entries(own.members ?? {}))
            players.set(id, {
              id,
              name: member.name ?? `#${id}`,
              warHits: member.attacks ?? 0,
              nonWarHits: 0,
            })
          const attacks = (await torn(
            `/v2/faction/attacks?limit=100&from=${war.start ?? 0}&to=${war.end ?? Math.floor(Date.now() / 1000)}`,
            key,
          )) as { attacks?: Attack[] }
          for (const attack of attacks.attacks ?? []) {
            if (!attack.attacker?.id || attack.is_ranked_war) continue
            const id = String(attack.attacker.id)
            const player = players.get(id)
            if (!player) continue
            player.nonWarHits += 1
          }
          return Response.json({
            war: { id: warId },
            players: [...players.values()],
          })
        } catch (error) {
          return Response.json(
            {
              error:
                error instanceof Error
                  ? error.message
                  : 'Unable to load ranked war data.',
            },
            { status: 502 },
          )
        }
      },
    },
  },
})

async function torn(path: string, key: string) {
  const url = new URL(`https://api.torn.com${path}`)
  url.searchParams.set('key', key)
  const { data } = await fetchTorn(url, {
    maxAgeMs: path.includes('/rankedwarreport') ? 300000 : 30000,
  })
  return data
}

async function tornV1Account(key: string) {
  const url = new URL('https://api.torn.com/user/')
  url.searchParams.set('selections', '')
  url.searchParams.set('key', key)
  const { data: payload } = await fetchTorn<{
    faction?: { faction_id?: number }
    error?: { error?: string }
  }>(url, { maxAgeMs: 60000 })
  if (!payload.faction?.faction_id) {
    throw new Error(
      payload.error?.error ?? 'Could not load the signed-in faction.',
    )
  }
  return payload
}

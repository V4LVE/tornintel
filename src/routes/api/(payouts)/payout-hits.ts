import { createFileRoute } from '@tanstack/react-router'
import { fetchTorn } from '#/lib/torn/torn-api.server'
import type {
  PayoutPlayer,
  PayoutPlayersResponse,
  PayoutWarsResponse,
} from '#/models/payouts'
import type {
  TornFactionAttacksResponse,
  TornRankedWarMembersReport,
} from '#/models/torn'

export const Route = createFileRoute('/api/(payouts)/payout-hits')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const key = request.headers.get('x-torn-api-key')?.trim()
        if (!key)
          return Response.json(
            { error: 'A Torn API key is required.' },
            { status: 401, headers: { 'Cache-Control': 'no-store' } },
          )
        const warId = new URL(request.url).searchParams.get('warId')
        try {
          if (!warId) {
            const history = await torn<{
              rankedwars?: Array<{ id: number; start: number; end: number }>
            }>('/v2/faction/rankedwars?limit=3', key)
            return Response.json(
              {
                wars: (history.rankedwars ?? []).slice(0, 3),
              } satisfies PayoutWarsResponse,
              { headers: { 'Cache-Control': 'no-store' } },
            )
          }
          if (!/^\d+$/.test(warId))
            return Response.json(
              { error: 'Invalid war ID.' },
              { status: 400, headers: { 'Cache-Control': 'no-store' } },
            )
          const [report, account] = await Promise.all([
            torn<TornRankedWarMembersReport>(
              `/v2/faction/${warId}/rankedwarreport`,
              key,
            ),
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
          const players = new Map<string, PayoutPlayer>()
          for (const member of own.members ?? [])
            players.set(String(member.id), {
              id: String(member.id),
              name: member.name,
              warHits: member.attacks,
              nonWarHits: 0,
            })
          if (!own.id || !war.start || !war.end || war.end < war.start)
            throw new Error(
              'The war report does not contain a completed war interval.',
            )
          await addOutsideHits(
            players,
            own.id,
            war.start,
            war.end,
            key,
            request.signal,
          )
          return Response.json(
            {
              war: { id: warId },
              players: [...players.values()],
            } satisfies PayoutPlayersResponse,
            { headers: { 'Cache-Control': 'no-store' } },
          )
        } catch (error) {
          return Response.json(
            {
              error:
                error instanceof Error
                  ? error.message
                  : 'Unable to load ranked war data.',
            },
            { status: 502, headers: { 'Cache-Control': 'no-store' } },
          )
        }
      },
    },
  },
})

async function addOutsideHits(
  players: Map<string, PayoutPlayer>,
  factionId: number,
  start: number,
  end: number,
  key: string,
  signal: AbortSignal,
) {
  let next: string | null =
    `/v2/faction/attacks?limit=100&filters=outgoing&from=${start}&to=${end}`
  const pages = new Set<string>()
  const seen = new Set<number>()
  while (next) {
    // Keep pagination on Torn and retain the selected war's bounds on every page.
    const url = new URL(next, 'https://api.torn.com')
    if (
      url.origin !== 'https://api.torn.com' ||
      url.pathname !== '/v2/faction/attacks'
    )
      throw new Error('Torn returned an invalid attack pagination link.')
    url.searchParams.delete('key')
    for (const [parameter, fallback] of [
      ['from', start],
      ['to', end],
    ] as const) {
      const value = Number(url.searchParams.get(parameter) ?? fallback)
      if (!Number.isFinite(value))
        throw new Error('Torn returned an invalid attack pagination window.')
      url.searchParams.set(
        parameter,
        String(Math.min(end, Math.max(start, value))),
      )
    }
    url.searchParams.set('filters', 'outgoing')
    url.searchParams.set('limit', '100')
    url.searchParams.sort()
    const path = `${url.pathname}${url.search}`
    if (pages.has(path) || pages.size >= 100)
      throw new Error(
        'Could not load the complete attack history. No partial payout totals are shown; please try again.',
      )
    pages.add(path)
    const data: TornFactionAttacksResponse = await torn(path, key, signal)
    for (const attack of data.attacks) {
      if (seen.has(attack.id)) continue
      seen.add(attack.id)
      if (
        attack.attacker?.faction?.id !== factionId ||
        attack.is_ranked_war !== false ||
        attack.is_interrupted ||
        !attack.chain ||
        attack.chain < 1 ||
        !['Attacked', 'Mugged', 'Hospitalized', 'Looted'].includes(
          attack.result,
        ) ||
        attack.ended < start ||
        attack.ended > end
      )
        continue
      const id = String(attack.attacker.id)
      const player = players.get(id) ?? {
        id,
        name: attack.attacker.name,
        warHits: 0,
        nonWarHits: 0,
      }
      player.nonWarHits += 1
      players.set(id, player)
    }
    next = data._metadata.links.next
  }
}

async function torn<T>(
  path: string,
  key: string,
  signal?: AbortSignal,
): Promise<T> {
  const url = new URL(`https://api.torn.com${path}`)
  url.searchParams.set('key', key)
  const { data } = await fetchTorn<T>(url, {
    signal,
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

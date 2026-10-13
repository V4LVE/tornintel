import { createFileRoute } from '@tanstack/react-router'
import { fetchTorn } from '#/lib/torn-api.server'
import {
  fetchPlayerIdentity,
  sharedHistorySince,
  statSharingRepository,
} from '#/lib/battle-stats/faction-sharing.server'
import { fetchFfScouterEstimates } from '#/lib/battle-stats/ff-scouter.server'
import { myStatsErrorResponse } from '#/lib/battle-stats/my-stats.server'
import type {
  FactionStatsMember,
  FactionStatsResponse,
  StatPoint,
} from '#/lib/battle-stats/my-stats'

type TornFactionResponse = {
  name?: string
  members?: Record<string, { name: string; level: number }>
}

export const Route = createFileRoute('/api/faction-stats')({
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

        try {
          // The faction comes from the viewer's own key, so shared stats are
          // only ever returned to members of the same faction.
          const viewer = await fetchPlayerIdentity(apiKey)
          if (!viewer.factionId) {
            return Response.json(
              { error: 'You are not in a faction.' },
              { status: 404 },
            )
          }

          const url = new URL(
            `https://api.torn.com/faction/${viewer.factionId}`,
          )
          url.searchParams.set('selections', '')
          url.searchParams.set('key', apiKey)
          const { data: faction } = await fetchTorn<TornFactionResponse>(url, {
            maxAgeMs: 60000,
          })
          const entries = Object.entries(faction.members ?? {})
          const memberIds = entries.map(([id]) => id)

          const [ffScouter, sharing] = await Promise.all([
            fetchFfScouterEstimates(apiKey, memberIds),
            loadSharing(viewer.factionId, memberIds),
          ])

          const members: FactionStatsMember[] = entries
            .map(([id, member]) => ({
              id,
              name: member.name,
              level: member.level,
              estimate: ffScouter.estimates.get(id) ?? null,
              shared: sharing.shared.get(id) ?? null,
            }))
            .sort(
              (left, right) =>
                memberTotal(right) - memberTotal(left) ||
                left.name.localeCompare(right.name),
            )

          const response: FactionStatsResponse = {
            faction: {
              id: viewer.factionId,
              name: faction.name ?? viewer.factionName ?? 'Your faction',
            },
            viewer: { id: viewer.id, isSharing: sharing.shared.has(viewer.id) },
            members,
            ffScouterReason: ffScouter.reason,
            sharingReason: sharing.reason,
          }
          return Response.json(response, {
            headers: { 'Cache-Control': 'no-store' },
          })
        } catch (error) {
          console.error('[tornintel] Faction stats fetch failed', {
            message: error instanceof Error ? error.message : String(error),
          })
          return myStatsErrorResponse(error)
        }
      },
    },
  },
})

function memberTotal(member: FactionStatsMember) {
  return member.shared?.current.total ?? member.estimate?.total ?? 0
}

async function loadSharing(factionId: string, memberIds: string[]) {
  const shared = new Map<string, NonNullable<FactionStatsMember['shared']>>()
  if (!process.env.DATABASE_URL)
    return { shared, reason: 'Stat sharing is not configured on this server.' }
  try {
    const { sharers, snapshots } = await statSharingRepository.loadFaction(
      factionId,
      memberIds,
      sharedHistorySince(),
    )
    const history = new Map<string, StatPoint[]>()
    for (const { playerId, ...point } of snapshots) {
      const points = history.get(playerId) ?? []
      points.push(point)
      history.set(playerId, points)
    }
    for (const sharer of sharers) {
      const points = (history.get(sharer.playerId) ?? []).filter(
        (point) => point.total > 0,
      )
      const current = points.at(-1)
      if (!current) continue
      shared.set(sharer.playerId, {
        current,
        history: points,
        updatedAt: sharer.updatedAt.getTime(),
      })
    }
    return { shared }
  } catch (error) {
    console.warn('[tornintel] Shared stats could not be loaded', {
      message: error instanceof Error ? error.message : String(error),
    })
    return { shared, reason: 'Shared stats could not be loaded right now.' }
  }
}

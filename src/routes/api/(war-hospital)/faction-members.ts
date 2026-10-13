import { createFileRoute } from '@tanstack/react-router'
import { resolveEnemyFaction } from '#/lib/war-hospital/enemy-faction.server'
import type { EnemyFaction } from '#/lib/war-hospital/enemy-faction.server'
import { fetchTorn, TornApiError } from '#/lib/torn/torn-api.server'
import { syncTravelTracking } from '#/lib/travel/travel.server'
import type { MemberStatus, TravelEstimate } from '#/lib/travel/travel'
import { syncSharedEvidence } from '#/lib/battle-stats/shared-evidence.server'
import type { BattleStatContributor } from '#/lib/battle-stats/shared-evidence.server'
import { estimateBattleStats } from '#/lib/battle-stats/estimator'
import type { FairFightObservation } from '#/lib/battle-stats/estimator'
import { loadFairFightEvidence } from '#/lib/battle-stats/fair-fight-evidence.server'

type TornMember = {
  name: string
  level: number
  last_action?: { relative?: string | number; status?: string }
  status: MemberStatus
}

type TornFactionResponse = {
  ID: number
  name: string
  tag: string
  members?: Record<string, TornMember>
  error?: { error: string; code: number }
}

const THIRTY_MINUTES = 30 * 60 * 1000

export const Route = createFileRoute('/api/(war-hospital)/faction-members')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const apiKey = request.headers.get('x-torn-api-key')?.trim()
        const requestedFactionId = new URL(request.url).searchParams
          .get('factionId')
          ?.trim()

        if (requestedFactionId && !/^\d{1,10}$/.test(requestedFactionId)) {
          console.warn('[tornintel] Rejected invalid faction ID', {
            factionId: requestedFactionId,
          })
          return Response.json(
            { error: 'Faction ID must contain digits only.' },
            { status: 400 },
          )
        }

        if (!apiKey) {
          return Response.json(
            { error: 'Enter your Torn API key to begin tracking.' },
            { status: 401 },
          )
        }

        let resolved: EnemyFaction | null
        try {
          resolved = requestedFactionId
            ? { id: requestedFactionId, source: 'manual' }
            : await resolveEnemyFaction(apiKey)
        } catch (error) {
          return Response.json(
            {
              error:
                error instanceof TornApiError
                  ? error.message
                  : 'Unable to find your ranked war opponent.',
            },
            { status: error instanceof TornApiError ? 401 : 502 },
          )
        }
        if (!resolved) {
          return Response.json(
            {
              error:
                'No ranked war found for your faction. Enter a faction ID to track.',
            },
            { status: 404 },
          )
        }
        const factionId = resolved.id

        const url = new URL(`https://api.torn.com/faction/${factionId}`)
        url.searchParams.set('selections', '')
        url.searchParams.set('key', apiKey)

        try {
          const { data: faction, fetchedAt: statusObservedAt } =
            await fetchTorn<TornFactionResponse>(url, {
              maxAgeMs: 5000,
            })
          if (faction.error) {
            console.error('[tornintel] Torn rejected faction request', {
              factionId,
              code: faction.error.code,
              message: faction.error.error,
            })
            return Response.json(
              { error: faction.error.error },
              { status: 502 },
            )
          }

          const now = Date.now()
          const entries = Object.entries(faction.members ?? {})
          const [travelTracking, { fairFightEvidence, sharedEvidence }] =
            await Promise.all([
              syncTravelTracking(
                entries.map(([playerId, member]) => ({
                  playerId,
                  status: member.status,
                })),
                statusObservedAt,
              ),
              (async () => {
                const loadedEvidence = await loadFairFightEvidence(apiKey, now)
                const syncedEvidence = await syncSharedEvidence(
                  loadedEvidence.evidence,
                  entries.map(([id]) => id),
                )
                return {
                  fairFightEvidence: loadedEvidence,
                  sharedEvidence: syncedEvidence,
                }
              })(),
            ])
          const members = entries
            .map(([id, member]) =>
              formatMember(
                id,
                member,
                now,
                sharedEvidence.observations.get(id) ?? [],
                sharedEvidence.contributors.get(id) ?? [],
                travelTracking.travel.get(id) ?? null,
              ),
            )
            .sort((left, right) => {
              const statusOrder = {
                Ready: 0,
                'In hospital': 1,
                Traveling: 2,
                Abroad: 3,
                Unavailable: 4,
              }
              const orderDifference =
                statusOrder[left.status] - statusOrder[right.status]

              return (
                orderDifference ||
                (left.travel?.latestArrivalAt ?? left.releaseAt) -
                  (right.travel?.latestArrivalAt ?? right.releaseAt)
              )
            })

          return Response.json(
            {
              faction: {
                id: faction.ID,
                name: faction.name,
                tag: faction.tag,
                source: resolved.source,
              },
              members,
              fairFightStatus: fairFightEvidence.status,
              fairFightReason: fairFightEvidence.reason,
              sharedTbsStatus: sharedEvidence.status,
              sharedTbsReason: sharedEvidence.reason,
              travelTrackingReason: travelTracking.reason,
              statusObservedAt,
              fetchedAt: now,
            },
            { headers: { 'Cache-Control': 'no-store' } },
          )
        } catch (error) {
          console.error('[tornintel] Faction fetch failed', {
            factionId,
            message: error instanceof Error ? error.message : String(error),
          })
          return Response.json(
            {
              error:
                error instanceof TornApiError
                  ? error.message
                  : 'Unable to reach Torn right now. Try refreshing shortly.',
            },
            { status: 502 },
          )
        }
      },
    },
  },
})

function formatMember(
  id: string,
  member: TornMember,
  now: number,
  fairFightObservations: FairFightObservation[],
  battleStatContributors: BattleStatContributor[],
  travel: TravelEstimate | null,
) {
  const state = member.status.state ?? 'Unknown'
  const releaseAt = (member.status.until ?? 0) * 1000
  const status =
    state === 'Hospital'
      ? 'In hospital'
      : state === 'Okay'
        ? 'Ready'
        : state === 'Traveling'
          ? 'Traveling'
          : state === 'Abroad'
            ? 'Abroad'
            : 'Unavailable'
  const remaining = releaseAt - now
  const lastSeen = member.last_action?.relative ?? member.last_action?.status
  const hospitalRecommended = status === 'Ready' && isOnline(lastSeen)

  return {
    id,
    name: member.name,
    level: member.level,
    status,
    detail: member.status.description ?? state,
    releaseAt: status === 'In hospital' ? releaseAt : now,
    reason:
      stripHtml(member.status.details) || member.status.description || state,
    lastSeen: lastSeen === undefined ? 'Unknown' : String(lastSeen),
    hospitalRecommended,
    battleStatContributors,
    travel,
    priority:
      status === 'Ready'
        ? 'High'
        : status === 'In hospital' && remaining <= THIRTY_MINUTES
          ? 'High'
          : status === 'In hospital'
            ? 'Medium'
            : 'Low',
    battleStats: estimateBattleStats({
      now,
      fairFightObservations,
    }),
  } as const
}

function isOnline(lastSeen: string | number | undefined) {
  return (
    lastSeen === 0 ||
    (typeof lastSeen === 'string' &&
      /^0\s*(?:minutes?|mins?|m)?(?:\s+ago)?$/i.test(lastSeen.trim()))
  )
}

function stripHtml(value?: string | null) {
  return (
    value
      ?.replace(/<[^>]*>/g, '')
      .replace(/\s+/g, ' ')
      .trim() ?? ''
  )
}

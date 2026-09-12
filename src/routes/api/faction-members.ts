import { createFileRoute } from '@tanstack/react-router'

type TornMember = {
  name: string
  level: number
  last_action?: { relative?: string; status?: string }
  status: {
    description?: string
    details?: string
    state?: string
    until?: number
  }
}

type TornFactionResponse = {
  ID: number
  name: string
  tag: string
  members?: Record<string, TornMember>
  error?: { error: string; code: number }
}

const THIRTY_MINUTES = 30 * 60 * 1000

export const Route = createFileRoute('/api/faction-members')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const apiKey = process.env.TORN_API_KEY
        const requestedFactionId = new URL(request.url).searchParams.get(
          'factionId',
        )
        const factionId =
          requestedFactionId || process.env.TORN_ENEMY_FACTION_ID || '56833'

        if (!/^\d{1,10}$/.test(factionId)) {
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
            { error: 'Torn API key has not been configured.' },
            { status: 500 },
          )
        }

        const url = new URL(`https://api.torn.com/faction/${factionId}`)
        url.searchParams.set('selections', '')
        url.searchParams.set('key', apiKey)

        try {
          const response = await fetch(url, { cache: 'no-store' })
          if (!response.ok) {
            throw new Error(`Torn returned HTTP ${response.status}`)
          }

          const faction = (await response.json()) as TornFactionResponse
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
          const members = Object.entries(faction.members ?? {})
            .map(([id, member]) => formatMember(id, member, now))
            .sort((left, right) => {
              const statusOrder = { Ready: 0, 'In hospital': 1, Traveling: 2 }
              const orderDifference =
                statusOrder[left.status] - statusOrder[right.status]

              return orderDifference || left.releaseAt - right.releaseAt
            })

          return Response.json(
            {
              faction: { id: faction.ID, name: faction.name, tag: faction.tag },
              members,
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
              error: 'Unable to reach Torn right now. Try refreshing shortly.',
            },
            { status: 502 },
          )
        }
      },
    },
  },
})

function formatMember(id: string, member: TornMember, now: number) {
  const state = member.status.state ?? 'Unknown'
  const releaseAt = (member.status.until ?? 0) * 1000
  const status =
    state === 'Hospital'
      ? 'In hospital'
      : state === 'Okay'
        ? 'Ready'
        : 'Traveling'
  const remaining = releaseAt - now

  return {
    id,
    name: member.name,
    level: member.level,
    status,
    detail: member.status.description ?? state,
    releaseAt: status === 'In hospital' ? releaseAt : now,
    reason:
      stripHtml(member.status.details) || member.status.description || state,
    lastSeen:
      member.last_action?.relative ?? member.last_action?.status ?? 'Unknown',
    priority:
      status === 'Ready'
        ? 'High'
        : status === 'In hospital' && remaining <= THIRTY_MINUTES
          ? 'High'
          : status === 'In hospital'
            ? 'Medium'
            : 'Low',
  } as const
}

function stripHtml(value?: string) {
  return (
    value
      ?.replace(/<[^>]*>/g, '')
      .replace(/\s+/g, ' ')
      .trim() ?? ''
  )
}

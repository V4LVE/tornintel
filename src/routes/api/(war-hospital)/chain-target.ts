import { createFileRoute } from '@tanstack/react-router'
import { shuffle } from '#/lib/levelling/levelling'
import { loadLevellingPlayers } from '#/lib/levelling/levelling.server'
import { fetchTorn, TornApiError } from '#/lib/torn/torn-api.server'
import type { TornBasicProfile } from '#/models/torn'
import type { ChainTargetResponse } from '#/models/war-hospital'

const MAX_PROFILE_CHECKS = 10

async function loadProfile(apiKey: string, signal: AbortSignal, id = '') {
  const url = new URL(`https://api.torn.com/user/${id}`)
  url.searchParams.set('selections', 'profile')
  url.searchParams.set('key', apiKey)
  const { data: profile, fetchedAt } = await fetchTorn<TornBasicProfile>(url, {
    maxAgeMs: id ? 60000 : 10000,
    signal,
    // Keep unavailable players out of repeated searches, but always recheck
    // available players before offering an attack.
    cacheWhen: (data) =>
      !id || (data as TornBasicProfile).status?.state !== 'Okay',
  })
  return { profile, fetchedAt }
}

export const Route = createFileRoute('/api/(war-hospital)/chain-target')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const apiKey = request.headers.get('x-torn-api-key')?.trim()
        if (!apiKey) {
          return Response.json(
            { error: 'Enter your Torn API key to find a keep-alive target.' },
            { status: 401, headers: { 'Cache-Control': 'no-store' } },
          )
        }

        try {
          const signal = AbortSignal.timeout(20000)
          const { profile: self } = await loadProfile(apiKey, signal)
          if (!self.player_id || !self.status) {
            throw new Error('Torn returned an incomplete hitter profile.')
          }
          if (self.status.state !== 'Okay') {
            throw new Error(
              'You must be out of hospital and in Torn to attack.',
            )
          }
          const excludeId = new URL(request.url).searchParams.get('excludeId')
          const { players, warning } = await loadLevellingPlayers()
          const candidates = shuffle(
            players.filter(
              (player) =>
                player.id !== self.player_id && String(player.id) !== excludeId,
            ),
          )

          for (const { id } of candidates.slice(0, MAX_PROFILE_CHECKS)) {
            let result
            try {
              result = await loadProfile(apiKey, signal, String(id))
            } catch (error) {
              // Deleted list entries should not prevent finding another target.
              if (error instanceof TornApiError && error.code === 6) continue
              throw error
            }
            const { profile, fetchedAt } = result
            if (
              profile.player_id !== id ||
              !profile.name ||
              !profile.level ||
              profile.status?.state !== 'Okay' ||
              (self.faction?.faction_id &&
                self.faction.faction_id === profile.faction?.faction_id)
            )
              continue

            return Response.json(
              {
                target: {
                  id,
                  name: profile.name,
                  level: profile.level,
                },
                fetchedAt,
                warning,
              } satisfies ChainTargetResponse,
              { headers: { 'Cache-Control': 'no-store' } },
            )
          }

          return Response.json(
            {
              target: null,
              fetchedAt: Date.now(),
              warning,
              message: candidates.length
                ? 'No available target found in this search. Try again for another selection.'
                : 'No other targets are available in the levelling list.',
            } satisfies ChainTargetResponse,
            { headers: { 'Cache-Control': 'no-store' } },
          )
        } catch (error) {
          return Response.json(
            {
              error:
                error instanceof Error
                  ? error.message
                  : 'Unable to find a keep-alive target.',
            },
            { status: 502, headers: { 'Cache-Control': 'no-store' } },
          )
        }
      },
    },
  },
})

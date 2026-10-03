import { createFileRoute } from '@tanstack/react-router'
import type { ChainTargetResponse } from '#/lib/chain-target'

type Attack = {
  attacker_id?: number
  defender_id?: number
  timestamp_ended?: number
  result?: string
  is_interrupted?: boolean
  modifiers?: { group_attack?: number }
}

type Profile = {
  player_id?: number
  name?: string
  level?: number
  status?: { state?: string }
  faction?: { faction_id?: number }
  attacks?: Record<string, Attack> | Attack[]
  error?: { error: string }
}

const RECENT_WINDOW = 14 * 24 * 60 * 60 * 1000
const MAX_PROFILE_CHECKS = 10
const WIN_RESULTS = new Set(['Hospitalized', 'Mugged', 'Attacked', 'Left'])

async function loadProfile(
  apiKey: string,
  signal: AbortSignal,
  id = '',
  selections = 'profile',
) {
  const url = new URL(`https://api.torn.com/user/${id}`)
  url.searchParams.set('selections', selections)
  url.searchParams.set('key', apiKey)
  const response = await fetch(url, {
    cache: 'no-store',
    signal,
  })
  if (!response.ok) throw new Error(`Torn returned HTTP ${response.status}.`)
  const profile = (await response.json()) as Profile
  if (profile.error) throw new Error(profile.error.error)
  return profile
}

export const Route = createFileRoute('/api/chain-target')({
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
          const self = await loadProfile(apiKey, signal, '', 'profile,attacks')
          if (!self.player_id || !self.status) {
            throw new Error('Torn returned an incomplete hitter profile.')
          }
          if (self.status.state !== 'Okay') {
            throw new Error(
              'You must be out of hospital and in Torn to attack.',
            )
          }
          if (!self.attacks) {
            throw new Error('Your API key must allow access to your attacks.')
          }

          const now = Date.now()
          const excludeId = new URL(request.url).searchParams.get('excludeId')
          const latestFights = new Map<number, Attack>()
          for (const attack of Object.values(self.attacks)) {
            if (
              attack.attacker_id !== self.player_id ||
              !attack.defender_id ||
              attack.defender_id === self.player_id ||
              !attack.timestamp_ended ||
              attack.timestamp_ended * 1000 < now - RECENT_WINDOW ||
              attack.timestamp_ended * 1000 > now
            )
              continue
            const previous = latestFights.get(attack.defender_id)
            if (
              !previous ||
              attack.timestamp_ended > previous.timestamp_ended!
            ) {
              latestFights.set(attack.defender_id, attack)
            }
          }

          const candidates = [...latestFights.entries()].filter(
            ([id, attack]) =>
              String(id) !== excludeId &&
              !attack.is_interrupted &&
              (attack.modifiers?.group_attack ?? 1) <= 1 &&
              WIN_RESULTS.has(attack.result ?? ''),
          )
          // Shuffle without replacement so each eligible player has equal priority.
          for (let index = candidates.length - 1; index > 0; index--) {
            const other = Math.floor(Math.random() * (index + 1))
            ;[candidates[index], candidates[other]] = [
              candidates[other],
              candidates[index],
            ]
          }

          for (const [id, attack] of candidates.slice(0, MAX_PROFILE_CHECKS)) {
            const profile = await loadProfile(apiKey, signal, String(id))
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
                  lastWonAt: attack.timestamp_ended! * 1000,
                },
                fetchedAt: Date.now(),
              } satisfies ChainTargetResponse,
              { headers: { 'Cache-Control': 'no-store' } },
            )
          }

          return Response.json(
            {
              target: null,
              fetchedAt: Date.now(),
              message: candidates.length
                ? 'No available target found in this search. Try again for another selection.'
                : 'No other recent wins found. Win a solo attack in the last 14 days to build your target pool.',
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

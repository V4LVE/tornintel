import { createFileRoute } from '@tanstack/react-router'
import type {
  LevellingTarget,
  LevellingTargetsResponse,
} from '#/lib/levelling/levelling'
import {
  isLevellingTier,
  playersInTier,
  shuffle,
} from '#/lib/levelling/levelling'
import { loadLevellingPlayers } from '#/lib/levelling/levelling.server'
import { fetchTorn, TornApiError } from '#/lib/torn/torn-api.server'

type BasicProfile = {
  player_id?: number
  name?: string
  level?: number
  status?: { state?: string; description?: string }
}

const TARGET_COUNT = 3
const MAX_PROFILE_CHECKS = 12
// Small parallel batches keep the search quick without bursting a key's rate limit.
const BATCH_SIZE = 3
const INCORRECT_ID = 6

export const Route = createFileRoute('/api/(levelling)/levelling-targets')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const headers = { 'Cache-Control': 'no-store' }
        const apiKey = request.headers.get('x-torn-api-key')?.trim()
        if (!apiKey) {
          return Response.json(
            { error: 'Enter your Torn API key to find levelling targets.' },
            { status: 401, headers },
          )
        }

        const params = new URL(request.url).searchParams
        const tier = params.get('tier')
        if (!isLevellingTier(tier)) {
          return Response.json(
            { error: 'Choose a valid levelling tier.' },
            { status: 400, headers },
          )
        }
        const excluded = new Set(
          (params.get('exclude') ?? '').split(',').filter(Boolean),
        )

        const pool = playersInTier(tier, (await loadLevellingPlayers()).players)
        const candidates = shuffle(
          pool.filter((player) => !excluded.has(String(player.id))),
        ).slice(0, MAX_PROFILE_CHECKS)
        const targets: LevellingTarget[] = []
        const skipped: LevellingTargetsResponse['skipped'] = []
        let checked = 0

        try {
          const signal = AbortSignal.timeout(20000)
          for (
            let start = 0;
            start < candidates.length && targets.length < TARGET_COUNT;
            start += BATCH_SIZE
          ) {
            const batch = candidates.slice(start, start + BATCH_SIZE)
            const profiles = await Promise.all(
              batch.map((player) => loadBasic(apiKey, player.id, signal)),
            )
            checked += batch.length
            batch.forEach((player, index) => {
              const profile = profiles[index]
              if (profile.player_id !== player.id) {
                skipped.push({ ...player, reason: 'Profile unavailable' })
                return
              }
              const state = profile.status?.state ?? 'Unknown'
              if (state !== 'Okay') {
                skipped.push({
                  ...player,
                  reason: profile.status?.description || state,
                })
                return
              }
              if (targets.length < TARGET_COUNT) {
                targets.push({
                  ...player,
                  name: profile.name || player.name,
                  currentLevel: profile.level ?? player.level,
                  status: state,
                })
              }
            })
          }
        } catch (error) {
          // Keep any targets already confirmed; only fail when nothing was found.
          if (!targets.length) {
            return Response.json(
              {
                error:
                  error instanceof TornApiError
                    ? error.message
                    : 'Unable to reach Torn right now. Try again shortly.',
              },
              {
                status: error instanceof TornApiError && error.code ? 401 : 502,
                headers,
              },
            )
          }
        }

        return Response.json(
          {
            targets,
            poolSize: pool.length,
            checked,
            skipped: skipped.map(({ id, name, reason }) => ({
              id,
              name,
              reason,
            })),
            fetchedAt: Date.now(),
            message:
              targets.length < TARGET_COUNT
                ? `Only ${targets.length} of ${checked} checked players can be attacked right now. Search again for another selection.`
                : undefined,
          } satisfies LevellingTargetsResponse,
          { headers },
        )
      },
    },
  },
})

async function loadBasic(apiKey: string, id: number, signal: AbortSignal) {
  const url = new URL(`https://api.torn.com/user/${id}`)
  url.searchParams.set('selections', 'basic')
  url.searchParams.set('key', apiKey)
  try {
    const { data } = await fetchTorn<BasicProfile>(url, {
      maxAgeMs: 60000,
      signal,
      // Unavailable players stay cached briefly; available ones are always rechecked.
      cacheWhen: (profile) =>
        (profile as BasicProfile).status?.state !== 'Okay',
    })
    return data
  } catch (error) {
    // A deleted or invalid list entry should not end the search; key errors should.
    if (error instanceof TornApiError && error.code === INCORRECT_ID) return {}
    throw error
  }
}

import { createHash } from 'node:crypto'
import type { FfScouterEstimate } from '../levelling/levelling'

const BASE_URL = 'https://ffscouter.com/api/v1'
// FF Scouter accepts up to 205 IDs per request and caches results for five minutes.
const MAX_STATS_TARGETS = 205
const STATS_MAX_AGE = 5 * 60 * 1000
const MAX_CACHE_ENTRIES = 5000

type FfScouterErrorBody = { code?: number; error?: string }

type PlayerStats = {
  player_id: number
  fair_fight: number | null
  bs_estimate: number | null
  bs_estimate_human: string | null
  last_updated: number | null
}

export type FfScouterTarget = PlayerStats & {
  name: string
  level: number
  last_action: number | null
  hospital_until?: number | null
}

export class FfScouterError extends Error {
  constructor(
    message: string,
    public status: number,
    public code?: number,
  ) {
    super(message)
  }
}

async function callFfScouter<T>(
  path: string,
  params: Record<string, string>,
  signal?: AbortSignal,
) {
  const url = new URL(BASE_URL + path)
  for (const [name, value] of Object.entries(params))
    url.searchParams.set(name, value)
  const response = await fetch(url, {
    cache: 'no-store',
    signal: signal ?? AbortSignal.timeout(20000),
  })
  const body = (await response.json().catch(() => null)) as
    (T & FfScouterErrorBody) | null
  if (!response.ok || !body || (!Array.isArray(body) && body.error)) {
    const error = body && !Array.isArray(body) ? body : null
    throw new FfScouterError(
      error?.code === 6
        ? 'This key is not registered with FF Scouter. Sign up at ffscouter.com first.'
        : error?.error || `FF Scouter returned HTTP ${response.status}.`,
      response.status,
      error?.code,
    )
  }
  return body as T
}

function toEstimate(stats: PlayerStats): FfScouterEstimate | null {
  if (stats.bs_estimate == null) return null
  return {
    total: stats.bs_estimate,
    human: stats.bs_estimate_human ?? String(stats.bs_estimate),
    fairFight: stats.fair_fight,
    updatedAt: stats.last_updated ? stats.last_updated * 1000 : null,
  }
}

// Estimates are cached per key because Fair Fight is relative to the key owner.
// All tornintel users share the server's IP-based FF Scouter rate limit.
export function createFfScouterClient() {
  const cache = new Map<
    string,
    { estimate: FfScouterEstimate | null; fetchedAt: number }
  >()

  async function getEstimates(
    apiKey: string,
    playerIds: number[],
    signal?: AbortSignal,
  ) {
    const keyHash = createHash('sha256').update(apiKey).digest('hex')
    const now = Date.now()
    const estimates = new Map<number, FfScouterEstimate | null>()
    const missing: number[] = []
    for (const id of new Set(playerIds)) {
      const cached = cache.get(`${keyHash}:${id}`)
      if (cached && now - cached.fetchedAt < STATS_MAX_AGE) {
        estimates.set(id, cached.estimate)
      } else missing.push(id)
    }
    for (let start = 0; start < missing.length; start += MAX_STATS_TARGETS) {
      const batch = missing.slice(start, start + MAX_STATS_TARGETS)
      const stats = await callFfScouter<PlayerStats[]>(
        '/get-stats',
        { key: apiKey, targets: batch.join(',') },
        signal,
      )
      const fetchedAt = Date.now()
      for (const item of stats) {
        const estimate = toEstimate(item)
        estimates.set(item.player_id, estimate)
        cache.delete(`${keyHash}:${item.player_id}`)
        cache.set(`${keyHash}:${item.player_id}`, { estimate, fetchedAt })
      }
    }
    while (cache.size > MAX_CACHE_ENTRIES)
      cache.delete(cache.keys().next().value!)
    return estimates
  }

  async function findTargets(
    apiKey: string,
    filters: {
      minLevel: number
      maxLevel: number
      maxFairFight: number
      inactiveOnly: boolean
    },
    signal?: AbortSignal,
  ) {
    const response = await callFfScouter<{ targets?: FfScouterTarget[] }>(
      '/get-targets',
      {
        key: apiKey,
        minlevel: String(filters.minLevel),
        maxlevel: String(filters.maxLevel),
        minff: '1',
        maxff: String(filters.maxFairFight),
        inactiveonly: filters.inactiveOnly ? '1' : '0',
        limit: '50',
      },
      signal,
    )
    return (response.targets ?? []).map((target) => ({
      id: target.player_id,
      name: target.name,
      level: target.level,
      lastActionAt: target.last_action ? target.last_action * 1000 : null,
      estimate: toEstimate(target),
    }))
  }

  async function checkKey(apiKey: string, signal?: AbortSignal) {
    const response = await callFfScouter<{
      is_registered?: boolean
      is_premium?: boolean
    }>('/check-key', { key: apiKey }, signal)
    return {
      registered: response.is_registered === true,
      premium: response.is_premium === true,
    }
  }

  return { getEstimates, findTargets, checkKey }
}

export const ffScouter = createFfScouterClient()

// A dedicated FF Scouter key is optional; without one the Torn key is used.
export function ffScouterKeyFrom(request: Request) {
  return (
    request.headers.get('x-ffscouter-key')?.trim() ||
    request.headers.get('x-torn-api-key')?.trim() ||
    ''
  )
}

export function ffScouterErrorResponse(error: unknown) {
  if (error instanceof FfScouterError) {
    return Response.json(
      { error: error.message },
      {
        // Pass on client errors such as an unregistered key; hide upstream failures.
        status: error.status >= 400 && error.status < 500 ? error.status : 502,
        headers: { 'Cache-Control': 'no-store' },
      },
    )
  }
  return Response.json(
    { error: 'Unable to reach FF Scouter right now. Try again shortly.' },
    { status: 502, headers: { 'Cache-Control': 'no-store' } },
  )
}

import { useEffect, useMemo, useState } from 'react'
import { sampleTimestamps } from '#/lib/battle-stats/my-stats'
import type {
  RangeKey,
  StatHistoryResponse,
  StatPoint,
} from '#/models/my-stats'

const CONCURRENCY = 3

type HistoryCache = Partial<Record<number, StatPoint>>

const storageKey = (playerId: number) => `tornintel.statHistory.${playerId}`

function loadCache(playerId: number): HistoryCache {
  try {
    const raw = window.localStorage.getItem(storageKey(playerId))
    return raw ? (JSON.parse(raw) as HistoryCache) : {}
  } catch {
    return {}
  }
}

function saveCache(playerId: number, cache: HistoryCache) {
  try {
    window.localStorage.setItem(storageKey(playerId), JSON.stringify(cache))
  } catch {
    // Storage full or blocked: history is simply refetched next visit.
  }
}

/** Forgets cached days so the next load fetches them through the server again. */
export function clearStatHistory(playerId: number) {
  try {
    window.localStorage.removeItem(storageKey(playerId))
  } catch {
    // Storage blocked: nothing was cached.
  }
}

async function fetchStatsAt(
  apiKey: string,
  timestamp: number,
  signal: AbortSignal,
) {
  const response = await fetch(`/api/my-stats-history?timestamp=${timestamp}`, {
    cache: 'no-store',
    headers: { 'X-Torn-Api-Key': apiKey },
    signal,
  })
  const payload = (await response.json()) as Partial<StatHistoryResponse> & {
    error?: string
  }
  if (!response.ok || payload.error)
    throw new Error(payload.error ?? 'Unable to load stat history.')
  return payload.point ?? null
}

/**
 * Builds a time series for the chosen range. Past days are fetched from Torn's
 * historical personalstats once, then served from this browser's storage.
 */
export function useStatHistory(
  apiKey: string,
  playerId: number | undefined,
  range: RangeKey,
  current: StatPoint | null,
  revision = 0,
) {
  const [cache, setCache] = useState<HistoryCache>({})
  const [progress, setProgress] = useState(1)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState('')
  const timestamps = useMemo(() => sampleTimestamps(range), [range])

  useEffect(() => {
    if (!apiKey || !playerId) return
    const controller = new AbortController()
    const { signal } = controller
    const stored = loadCache(playerId)
    setCache(stored)

    const missing = timestamps.filter((timestamp) => !(timestamp in stored))
    if (missing.length === 0) {
      setIsLoading(false)
      setProgress(1)
      return
    }

    setIsLoading(true)
    setError('')
    setProgress(0)
    const working: HistoryCache = { ...stored }
    let done = 0
    let next = 0

    async function worker() {
      while (!signal.aborted && next < missing.length) {
        const timestamp = missing[next++]
        const point = await fetchStatsAt(apiKey, timestamp, signal)
        // Store misses as zeros so dates before the account existed aren't re-requested.
        working[timestamp] = point ?? {
          timestamp,
          strength: 0,
          defense: 0,
          speed: 0,
          dexterity: 0,
          total: 0,
        }
        done++
        setProgress(done / missing.length)
      }
    }

    Promise.all(Array.from({ length: CONCURRENCY }, worker))
      .catch((requestError: unknown) => {
        if (!signal.aborted)
          setError(
            requestError instanceof Error
              ? requestError.message
              : 'Unable to load stat history.',
          )
      })
      .finally(() => {
        saveCache(playerId, working)
        if (!signal.aborted) {
          setCache(working)
          setIsLoading(false)
        }
      })

    return () => controller.abort()
  }, [apiKey, playerId, timestamps, revision])

  const points = useMemo(() => {
    const series = timestamps
      .map((timestamp) => cache[timestamp])
      .filter((point): point is StatPoint => Boolean(point?.total))
    if (current) series.push(current)
    return series
  }, [cache, current, timestamps])

  return { points, isLoading, progress, error }
}

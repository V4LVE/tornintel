import { createHash } from 'node:crypto'

type TornResult = { data: unknown; fetchedAt: number }
type CacheEntry = {
  result?: TornResult
  pending?: Promise<TornResult>
  expiresAt: number
}
type TornRequestOptions = {
  maxAgeMs: number
  signal?: AbortSignal
  cacheWhen?: (data: unknown) => boolean
}

export class TornApiError extends Error {
  constructor(
    message: string,
    public code?: number,
  ) {
    super(message)
  }
}

// Each server process keeps a bounded cache. Hashes isolate keys without storing
// credentials in cache identifiers, and pending promises coalesce duplicate calls.
export function createTornClient(maxEntries = 256) {
  const cache = new Map<string, CacheEntry>()

  return async function fetchTorn<T>(
    url: URL,
    { maxAgeMs, signal, cacheWhen }: TornRequestOptions,
  ): Promise<{ data: T; fetchedAt: number }> {
    const canonicalUrl = new URL(url)
    canonicalUrl.searchParams.sort()
    const cacheKey = createHash('sha256')
      .update(canonicalUrl.href)
      .digest('hex')
    const now = Date.now()
    const cached = cache.get(cacheKey)
    if (cached?.pending)
      return structuredClone(await cached.pending) as {
        data: T
        fetchedAt: number
      }
    if (
      cached?.result &&
      cached.expiresAt > now &&
      now - cached.result.fetchedAt < maxAgeMs
    ) {
      return structuredClone(cached.result) as { data: T; fetchedAt: number }
    }

    for (const [key, entry] of cache) {
      if (!entry.pending && entry.expiresAt <= now) cache.delete(key)
    }
    // Never evict an in-flight request: that would allow a duplicate upstream call.
    if (!cache.has(cacheKey) && cache.size >= maxEntries) {
      const oldest = [...cache].find(([, entry]) => !entry.pending)
      if (oldest) cache.delete(oldest[0])
    }
    const entry: CacheEntry = { expiresAt: 0 }
    const pending = (async () => {
      const response = await fetch(url, {
        cache: 'no-store',
        signal: signal ?? AbortSignal.timeout(20000),
      })
      if (!response.ok)
        throw new TornApiError(`Torn returned HTTP ${response.status}.`)
      const data = (await response.json()) as {
        error?: { error?: string; code?: number }
      }
      if (data.error)
        throw new TornApiError(
          data.error.error ?? 'Torn API request failed.',
          data.error.code,
        )
      const result = { data, fetchedAt: Date.now() }
      if (maxAgeMs > 0 && (!cacheWhen || cacheWhen(data))) {
        entry.result = structuredClone(result)
        entry.expiresAt = result.fetchedAt + maxAgeMs
      }
      return result
    })()
    entry.pending = pending
    if (cache.size < maxEntries || cache.has(cacheKey))
      cache.set(cacheKey, entry)
    try {
      return structuredClone(await pending) as { data: T; fetchedAt: number }
    } finally {
      entry.pending = undefined
      if (!entry.result && cache.get(cacheKey) === entry) cache.delete(cacheKey)
    }
  }
}

export const fetchTorn = createTornClient()

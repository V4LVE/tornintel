import { useEffect } from 'react'

// Poll only while visible, wait for completion before scheduling, and refresh
// immediately on return if the last request is old enough.
export function startVisiblePolling(
  refresh: (signal: AbortSignal) => Promise<void>,
  intervalMs: number,
  page: Pick<
    Document,
    'visibilityState' | 'addEventListener' | 'removeEventListener'
  > = document,
) {
  let timer: ReturnType<typeof setTimeout> | undefined
  let controller: AbortController | undefined
  let lastStartedAt = -Infinity
  let stopped = false

  function schedule() {
    if (stopped || page.visibilityState === 'hidden' || controller) return
    clearTimeout(timer)
    timer = setTimeout(
      () => void run(),
      Math.max(0, intervalMs - (Date.now() - lastStartedAt)),
    )
  }

  async function run() {
    if (stopped || page.visibilityState === 'hidden' || controller) return
    lastStartedAt = Date.now()
    controller = new AbortController()
    try {
      await refresh(controller.signal)
    } catch {
      // Callers render their request errors; polling must still resume.
    } finally {
      controller = undefined
      // A slow request gets a full interval before retrying.
      lastStartedAt = Date.now()
      schedule()
    }
  }

  function visibilityChanged() {
    clearTimeout(timer)
    schedule()
  }

  page.addEventListener('visibilitychange', visibilityChanged)
  schedule()
  return () => {
    stopped = true
    clearTimeout(timer)
    controller?.abort()
    page.removeEventListener('visibilitychange', visibilityChanged)
  }
}

export function useVisiblePolling(
  refresh: (signal: AbortSignal) => Promise<void>,
  enabled: boolean,
  intervalMs = 30000,
) {
  useEffect(() => {
    if (!enabled) return
    return startVisiblePolling(refresh, intervalMs)
  }, [enabled, intervalMs, refresh])
}

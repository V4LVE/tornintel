import assert from 'node:assert/strict'
import { test } from 'node:test'
import { setImmediate } from 'node:timers/promises'
import { startVisiblePolling } from './use-visible-polling'

class Page extends EventTarget {
  visibilityState: DocumentVisibilityState = 'visible'
  setVisibility(state: DocumentVisibilityState) {
    this.visibilityState = state
    this.dispatchEvent(new Event('visibilitychange'))
  }
}

test('polls only visible pages and resumes stale data on return', async (context) => {
  context.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 1000 })
  const page = new Page()
  let calls = 0
  const stop = startVisiblePolling(
    async () => {
      calls++
    },
    30000,
    page,
  )
  context.mock.timers.tick(0)
  await setImmediate()
  assert.equal(calls, 1)
  page.setVisibility('hidden')
  context.mock.timers.tick(120000)
  await setImmediate()
  assert.equal(calls, 1)
  page.setVisibility('visible')
  context.mock.timers.tick(0)
  await setImmediate()
  assert.equal(calls, 2)
  page.setVisibility('hidden')
  context.mock.timers.tick(1000)
  page.setVisibility('visible')
  context.mock.timers.tick(0)
  await setImmediate()
  assert.equal(calls, 2)
  context.mock.timers.tick(29000)
  await setImmediate()
  assert.equal(calls, 3)
  stop()
  context.mock.timers.tick(60000)
  assert.equal(calls, 3)
})

test('does not overlap slow requests and aborts them on cleanup', async (context) => {
  context.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 1000 })
  const page = new Page()
  let calls = 0
  let signal: AbortSignal | undefined
  let finish: (() => void) | undefined
  const stop = startVisiblePolling(
    (requestSignal) => {
      calls++
      signal = requestSignal
      return new Promise<void>((resolve) => {
        finish = resolve
      })
    },
    30000,
    page,
  )
  context.mock.timers.tick(0)
  context.mock.timers.tick(90000)
  page.setVisibility('hidden')
  page.setVisibility('visible')
  context.mock.timers.tick(0)
  assert.equal(calls, 1)
  finish?.()
  await setImmediate()
  context.mock.timers.tick(30000)
  assert.equal(calls, 2)
  stop()
  assert.equal(signal?.aborted, true)
  finish?.()
  await setImmediate()
  context.mock.timers.tick(60000)
  assert.equal(calls, 2)
})

test('does not fetch on an initially hidden page', async (context) => {
  context.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 1000 })
  const page = new Page()
  page.visibilityState = 'hidden'
  let calls = 0
  const stop = startVisiblePolling(
    async () => {
      calls++
    },
    30000,
    page,
  )
  context.mock.timers.tick(60000)
  assert.equal(calls, 0)
  page.setVisibility('visible')
  context.mock.timers.tick(0)
  await setImmediate()
  assert.equal(calls, 1)
  stop()
})

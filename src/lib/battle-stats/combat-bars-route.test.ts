import assert from 'node:assert/strict'
import { test } from 'node:test'
import { Route } from '../../routes/api/combat-bars'

const handlers = Route.options.server?.handlers
if (!handlers || typeof handlers === 'function' || !handlers.GET) {
  throw new Error('Expected a combat bars GET handler')
}
const handler = handlers.GET

test('preserves the upstream timestamp when reusing combat bars', async (context) => {
  context.mock.timers.enable({ apis: ['Date'], now: Date.now() })
  const originalFetch = globalThis.fetch
  let calls = 0
  globalThis.fetch = async () => {
    calls++
    return Response.json({
      bars: {
        energy: { current: 50, maximum: 100, tick_time: 60 },
        chain: { current: 10, timeout: 100 },
      },
    })
  }
  const invoke = async () => {
    const response = await handler({
      request: new Request('http://localhost/api/combat-bars', {
        headers: { 'x-torn-api-key': 'bars-cache-test' },
      }),
    } as never)
    if (!(response instanceof Response)) throw new Error('Expected a response')
    assert.equal(response.status, 200)
    return response.json()
  }
  try {
    const first = await invoke()
    context.mock.timers.tick(1000)
    const cached = await invoke()
    assert.equal(cached.fetchedAt, first.fetchedAt)
    assert.equal(calls, 1)
    context.mock.timers.tick(2000)
    const fresh = await invoke()
    assert.equal(fresh.fetchedAt, first.fetchedAt + 3000)
    assert.equal(calls, 2)
  } finally {
    globalThis.fetch = originalFetch
  }
})

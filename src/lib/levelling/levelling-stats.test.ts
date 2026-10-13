import assert from 'node:assert/strict'
import { test } from 'node:test'
import { Route } from '../../routes/api/(levelling)/levelling-stats'

const handlers = Route.options.server?.handlers
if (!handlers || typeof handlers === 'function' || !handlers.GET) {
  throw new Error('Expected a levelling stats GET handler')
}
const handler = handlers.GET

async function invoke(key: string, query: string) {
  const response = await handler({
    request: new Request(`http://localhost/api/levelling-stats${query}`, {
      headers: key ? { 'x-torn-api-key': key } : {},
    }),
  } as never)
  if (!(response instanceof Response)) throw new Error('Expected a response')
  return response
}

test('validates the key and player IDs', async () => {
  assert.equal((await invoke('', '?ids=1')).status, 401)
  assert.equal((await invoke('stats-key', '?ids=abc')).status, 400)
})

test('estimates TBS from Fair Fight evidence like the war hospital', async () => {
  const originalFetch = globalThis.fetch
  const savedUrl = process.env.DATABASE_URL
  delete process.env.DATABASE_URL
  const ended = Math.floor(Date.now() / 1000) - 3600
  globalThis.fetch = async (input) => {
    const url = new URL(String(input))
    assert.equal(url.pathname, '/user/')
    assert.equal(
      url.searchParams.get('selections'),
      'profile,battlestats,attacks',
    )
    return Response.json({
      player_id: 100,
      name: 'Hitter',
      strength: 1_000_000,
      speed: 1_000_000,
      defense: 1_000_000,
      dexterity: 1_000_000,
      attacks: {
        a: {
          attacker_id: 100,
          defender_id: 700001,
          timestamp_ended: ended,
          result: 'Hospitalized',
          modifiers: { fair_fight: 1.5, group_attack: 1 },
        },
      },
    })
  }
  try {
    const response = await invoke('stats-key', '?ids=700001,700002,700001')
    assert.equal(response.status, 200)
    const payload = await response.json()
    assert.deepEqual(Object.keys(payload.stats), ['700001'])
    const estimate = payload.stats['700001'].battleStats
    assert.ok(estimate.sources.includes('FAIR_FIGHT'))
    assert.ok(estimate.estimate > 0 || estimate.lowerBound > 0)
    assert.match(payload.sharedTbsReason, /not configured/)
  } finally {
    globalThis.fetch = originalFetch
    if (savedUrl !== undefined) process.env.DATABASE_URL = savedUrl
  }
})

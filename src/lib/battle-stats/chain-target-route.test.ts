import assert from 'node:assert/strict'
import { test } from 'node:test'
import { Route } from '../../routes/api/chain-target'

const handlers = Route.options.server?.handlers
if (!handlers || typeof handlers === 'function' || !handlers.GET) {
  throw new Error('Expected a chain target GET handler')
}
const handler = handlers.GET

async function invoke(key = 'test-key', query = '') {
  const response = await handler({
    request: new Request(`http://localhost/api/chain-target${query}`, {
      headers: key ? { 'x-torn-api-key': key } : {},
    }),
  } as never)
  if (!(response instanceof Response)) throw new Error('Expected a response')
  return response
}

test('requires an API key before accessing Torn', async () => {
  const response = await invoke('')
  assert.equal(response.status, 401)
  assert.match((await response.json()).error, /API key/)
})

test('selects a recent solo win, verifies availability, and excludes unsafe targets', async () => {
  const originalFetch = globalThis.fetch
  const now = Math.floor(Date.now() / 1000) - 1
  const calls: string[] = []
  const fight = (id: number, extra = {}) => ({
    attacker_id: 100,
    defender_id: id,
    timestamp_ended: now,
    result: 'Hospitalized',
    modifiers: { group_attack: 1 },
    ...extra,
  })
  globalThis.fetch = async (input) => {
    const url = new URL(String(input))
    assert.equal(url.searchParams.get('key'), 'test-key')
    calls.push(url.pathname)
    if (url.pathname === '/user/') {
      return Response.json({
        player_id: 100,
        status: { state: 'Okay' },
        faction: { faction_id: 500 },
        attacks: {
          win: fight(1),
          hospital: fight(2),
          traveling: fight(3),
          abroad: fight(4),
          factionMate: fight(5),
          old: fight(6, { timestamp_ended: now - 15 * 86400 }),
          incoming: fight(7, { attacker_id: 7, defender_id: 100 }),
          group: fight(8, { modifiers: { group_attack: 2 } }),
          interrupted: fight(9, { is_interrupted: true }),
          priorWin: fight(10, { timestamp_ended: now - 10 }),
          laterLoss: fight(10, { result: 'Lost' }),
          excluded: fight(11),
        },
      })
    }
    const id = Number(url.pathname.split('/').at(-1))
    assert.ok([1, 2, 3, 4, 5].includes(id))
    return Response.json({
      player_id: id,
      name: `Player ${id}`,
      level: 25,
      status: {
        state: { 2: 'Hospital', 3: 'Traveling', 4: 'Abroad' }[id] ?? 'Okay',
      },
      faction: { faction_id: id === 5 ? 500 : 600 },
    })
  }
  try {
    const response = await invoke('test-key', '?excludeId=11')
    const payload = await response.json()
    assert.equal(response.status, 200)
    assert.equal(response.headers.get('cache-control'), 'no-store')
    assert.deepEqual(payload.target, {
      id: 1,
      name: 'Player 1',
      level: 25,
      lastWonAt: now * 1000,
    })
    assert.ok(payload.fetchedAt > 0)
    assert.equal(new Set(calls).size, calls.length)
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('returns an empty state when no qualifying wins exist', async () => {
  const originalFetch = globalThis.fetch
  globalThis.fetch = async () =>
    Response.json({
      player_id: 100,
      status: { state: 'Okay' },
      attacks: {},
    })
  try {
    const response = await invoke()
    const payload = await response.json()
    assert.equal(response.status, 200)
    assert.equal(payload.target, null)
    assert.match(payload.message, /No other recent wins/)
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('surfaces Torn errors without returning a target', async () => {
  const originalFetch = globalThis.fetch
  globalThis.fetch = async () =>
    Response.json({ error: { error: 'Too many requests' } })
  try {
    const response = await invoke()
    assert.equal(response.status, 502)
    assert.equal((await response.json()).error, 'Too many requests')
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('caps profile checks when all candidates are unavailable', async () => {
  const originalFetch = globalThis.fetch
  const now = Math.floor(Date.now() / 1000) - 1
  let profileChecks = 0
  globalThis.fetch = async (input) => {
    const url = new URL(String(input))
    if (url.pathname === '/user/') {
      return Response.json({
        player_id: 100,
        status: { state: 'Okay' },
        attacks: Array.from({ length: 30 }, (_, index) => ({
          attacker_id: 100,
          defender_id: index + 1,
          timestamp_ended: now,
          result: 'Mugged',
        })),
      })
    }
    profileChecks++
    return Response.json({ status: { state: 'Hospital' } })
  }
  try {
    const response = await invoke()
    assert.equal((await response.json()).target, null)
    assert.equal(profileChecks, 10)
  } finally {
    globalThis.fetch = originalFetch
  }
})

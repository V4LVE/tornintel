import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  bundledPlayers,
  levellingListRepository,
} from '../levelling/levelling.server'
import { Route } from '../../routes/api/(war-hospital)/chain-target'
import type { TestContext } from 'node:test'
import type { LevellingListChange } from '#/models/levelling'

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

function mockList(context: TestContext, ids: number[]) {
  const originalUrl = process.env.DATABASE_URL
  process.env.DATABASE_URL = 'postgres://test'
  context.after(() => {
    if (originalUrl === undefined) delete process.env.DATABASE_URL
    else process.env.DATABASE_URL = originalUrl
  })
  const change = (playerId: number, removed: boolean): LevellingListChange => ({
    playerId,
    name: `Player ${playerId}`,
    level: 25,
    totalEstimate: null,
    removed,
    addedById: null,
    addedByName: null,
  })
  context.mock.method(levellingListRepository, 'load', async () => [
    ...bundledPlayers.map((player) => change(player.id, true)),
    ...ids.map((id) => change(id, false)),
  ])
}

const self = {
  player_id: 100,
  status: { state: 'Okay' },
  faction: { faction_id: 500 },
}

function profile(id: number, state = 'Okay', factionId = 600) {
  return {
    player_id: id,
    name: `Player ${id}`,
    level: 25,
    status: { state },
    faction: { faction_id: factionId },
  }
}

test('requires an API key before accessing Torn', async (context) => {
  context.mock.method(globalThis, 'fetch', () => {
    assert.fail('Must not call Torn without a key')
  })
  const response = await invoke('')
  assert.equal(response.status, 401)
  assert.match((await response.json()).error, /API key/)
})

test('uses shared list changes without attacks access and excludes unsafe targets', async (context) => {
  mockList(context, [100, 2, 3, 4, 5, 6, 7, 1])
  context.mock.method(Math, 'random', () => 0.999)
  const calls: string[] = []
  context.mock.method(globalThis, 'fetch', async (input: URL) => {
    const url = new URL(String(input))
    calls.push(url.pathname)
    if (url.pathname === '/user/') {
      assert.equal(url.searchParams.get('selections'), 'profile')
      return Response.json(self)
    }
    const id = Number(url.pathname.split('/').at(-1))
    assert.ok([1, 2, 3, 4, 5, 6].includes(id))
    if (id === 6)
      return Response.json({ error: { code: 6, error: 'Incorrect ID' } })
    return Response.json(
      profile(
        id,
        { 2: 'Hospital', 3: 'Traveling', 4: 'Abroad' }[id] ?? 'Okay',
        id === 5 ? 500 : 600,
      ),
    )
  })
  const response = await invoke('list-key', '?excludeId=7')
  const payload = await response.json()
  assert.equal(response.status, 200)
  assert.equal(response.headers.get('cache-control'), 'no-store')
  assert.deepEqual(payload.target, { id: 1, name: 'Player 1', level: 25 })
  assert.ok(payload.fetchedAt > 0)
  assert.equal(new Set(calls).size, calls.length)
  assert.equal(calls.length, 7)
})

test('returns an empty state when the shared list has no candidates', async (context) => {
  mockList(context, [])
  context.mock.method(globalThis, 'fetch', async () => Response.json(self))
  const response = await invoke('empty-list-key')
  const payload = await response.json()
  assert.equal(response.status, 200)
  assert.equal(payload.target, null)
  assert.match(payload.message, /levelling list/)
})

test('surfaces target key errors instead of skipping them', async (context) => {
  mockList(context, [1])
  context.mock.method(globalThis, 'fetch', async (input: URL) =>
    Response.json(
      new URL(String(input)).pathname === '/user/'
        ? self
        : { error: { code: 2, error: 'Incorrect key' } },
    ),
  )
  const response = await invoke('torn-error-key')
  assert.equal(response.status, 502)
  assert.equal((await response.json()).error, 'Incorrect key')
})

test('caps profile checks when list candidates are unavailable', async (context) => {
  mockList(
    context,
    Array.from({ length: 30 }, (_, index) => index + 1),
  )
  let profileChecks = 0
  context.mock.method(globalThis, 'fetch', async (input: URL) => {
    if (new URL(String(input)).pathname === '/user/') return Response.json(self)
    profileChecks++
    return Response.json({ status: { state: 'Hospital' } })
  })
  const response = await invoke('unavailable-list-key')
  assert.equal((await response.json()).target, null)
  assert.equal(profileChecks, 10)
})

test('rechecks ready targets and caches unavailable profiles', async (context) => {
  mockList(context, [1])
  let selfCalls = 0
  let targetCalls = 0
  context.mock.method(globalThis, 'fetch', async (input: URL) => {
    if (new URL(String(input)).pathname === '/user/') {
      selfCalls++
      return Response.json(self)
    }
    targetCalls++
    return Response.json(profile(1, targetCalls === 1 ? 'Okay' : 'Hospital'))
  })
  assert.equal((await (await invoke('chain-cache-key')).json()).target.id, 1)
  assert.equal((await (await invoke('chain-cache-key')).json()).target, null)
  assert.equal((await (await invoke('chain-cache-key')).json()).target, null)
  assert.equal(selfCalls, 1)
  assert.equal(targetCalls, 2)
})

test('uses the bundled list with a warning when storage is unconfigured', async (context) => {
  const originalUrl = process.env.DATABASE_URL
  delete process.env.DATABASE_URL
  context.after(() => {
    if (originalUrl !== undefined) process.env.DATABASE_URL = originalUrl
  })
  context.mock.method(levellingListRepository, 'load', () => {
    assert.fail('Must not access the database')
  })
  context.mock.method(globalThis, 'fetch', async (input: URL) => {
    const url = new URL(String(input))
    if (url.pathname === '/user/') return Response.json(self)
    const id = Number(url.pathname.split('/').at(-1))
    assert.ok(bundledPlayers.some((player) => player.id === id))
    return Response.json(profile(id))
  })
  const response = await invoke('bundled-list-key')
  const payload = await response.json()
  assert.equal(response.status, 200)
  assert.ok(payload.target)
  assert.match(payload.warning, /storage is not configured/)
})

test('rejects searching while the hitter is unavailable', async (context) => {
  let calls = 0
  context.mock.method(globalThis, 'fetch', async () => {
    calls++
    return Response.json({ ...self, status: { state: 'Traveling' } })
  })
  const response = await invoke('traveling-hitter-key')
  assert.equal(response.status, 502)
  assert.match((await response.json()).error, /in Torn/)
  assert.equal(calls, 1)
})

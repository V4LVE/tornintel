import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  LEVELLING_TIERS,
  applyListChanges,
  normalizePlayers,
  parseStat,
  playersInTier,
  tierForLevel,
} from './levelling'
import { bundledPlayers } from './levelling.server'
import { Route } from '../routes/api/levelling-targets'

const handlers = Route.options.server?.handlers
if (!handlers || typeof handlers === 'function' || !handlers.GET) {
  throw new Error('Expected a levelling targets GET handler')
}
const handler = handlers.GET

async function invoke(key = 'test-key', query = '?tier=tier3') {
  const response = await handler({
    request: new Request(`http://localhost/api/levelling-targets${query}`, {
      headers: key ? { 'x-torn-api-key': key } : {},
    }),
  } as never)
  if (!(response instanceof Response)) throw new Error('Expected a response')
  return response
}

test('parses list stats with commas and ignores invalid values', () => {
  assert.equal(parseStat('1,234,567'), 1234567)
  assert.equal(parseStat(42), 42)
  assert.equal(parseStat('n/a'), 0)
  assert.equal(parseStat(undefined), 0)
})

test('normalizes players, removes duplicates and sorts by total', () => {
  const players = normalizePlayers([
    { name: 'Strong', id: '1', lvl: '20', total: '2,000' },
    { name: 'Broken', id: 'x', lvl: '20' },
    { name: 'Weak', id: '2', lvl: '15', total: '500' },
    { name: 'Strong again', id: '1', lvl: '21', total: '9' },
  ])
  assert.deepEqual(
    players.map(({ id, name, level, total }) => ({ id, name, level, total })),
    [
      { id: 2, name: 'Weak', level: 15, total: 500 },
      { id: 1, name: 'Strong', level: 20, total: 2000 },
    ],
  )
})

test('bundled lists load and tiers respect their level ranges', () => {
  assert.ok(bundledPlayers.length > 100)
  for (const player of playersInTier('tier2', bundledPlayers)) {
    assert.ok(player.level >= 11 && player.level <= 20)
  }
})

test('every level from 1 to 100 belongs to exactly one tier', () => {
  for (let level = 1; level <= 100; level++) {
    const tier = tierForLevel(level)
    assert.ok(tier, `level ${level} has no tier`)
    const { min, max } = LEVELLING_TIERS[tier]
    assert.ok(level >= min && level <= max)
  }
  assert.equal(tierForLevel(0), null)
  assert.equal(tierForLevel(101), null)
  const players = normalizePlayers(
    [1, 10, 11, 100].map((lvl) => ({ name: 'P', id: String(lvl), lvl })),
  )
  assert.deepEqual(
    playersInTier('tier1', players).map((player) => player.level),
    [1, 10],
  )
})

test('applies shared additions and removals to the bundled lists', () => {
  const bundled = normalizePlayers([
    { name: 'Kept', id: '1', lvl: '20', total: '300' },
    { name: 'Removed', id: '2', lvl: '20', total: '200' },
  ])
  const change = {
    level: 20,
    totalEstimate: null,
    removed: false,
    addedById: null,
    addedByName: null,
  }
  const players = applyListChanges(bundled, [
    { ...change, playerId: 2, name: 'Removed', removed: true },
    {
      ...change,
      playerId: 3,
      name: 'New',
      totalEstimate: 150,
      addedById: 9,
      addedByName: 'Scout',
    },
    // Re-adding a bundled player keeps the recorded list entry.
    { ...change, playerId: 1, name: 'Kept renamed', totalEstimate: 999 },
  ])
  assert.deepEqual(
    players.map(({ id, name, total, str, addedBy }) => ({
      id,
      name,
      total,
      str,
      addedBy,
    })),
    [
      {
        id: 3,
        name: 'New',
        total: 150,
        str: null,
        addedBy: { id: 9, name: 'Scout' },
      },
      {
        id: 1,
        name: 'Kept',
        total: 300,
        str: 0,
        addedBy: undefined,
      },
    ],
  )
})

test('requires an API key and a valid tier', async () => {
  const missingKey = await invoke('')
  assert.equal(missingKey.status, 401)
  assert.match((await missingKey.json()).error, /API key/)
  const badTier = await invoke('test-key', '?tier=tier11')
  assert.equal(badTier.status, 400)
})

test('returns only available players and skips invalid IDs', async () => {
  const originalFetch = globalThis.fetch
  const pool = playersInTier('tier3', bundledPlayers)
  const [hospital, invalid, ...rest] = pool.map((player) => player.id)
  // Keep the search small and deterministic by excluding everyone else.
  const keep = new Set([hospital, invalid, rest[0], rest[1], rest[2]])
  const exclude = pool
    .filter((player) => !keep.has(player.id))
    .map((player) => player.id)
    .join(',')
  globalThis.fetch = async (input) => {
    const url = new URL(String(input))
    assert.equal(url.searchParams.get('key'), 'test-key')
    assert.equal(url.searchParams.get('selections'), 'basic')
    const id = Number(url.pathname.split('/').pop())
    if (id === invalid)
      return Response.json({ error: { code: 6, error: 'Incorrect ID' } })
    return Response.json({
      player_id: id,
      name: 'Player ' + id,
      level: 18,
      status:
        id === hospital
          ? { state: 'Hospital', description: 'In hospital for 5 mins' }
          : { state: 'Okay', description: 'Okay' },
    })
  }
  try {
    const response = await invoke('test-key', `?tier=tier3&exclude=${exclude}`)
    assert.equal(response.status, 200)
    const payload = await response.json()
    assert.equal(payload.targets.length, 3)
    assert.deepEqual(
      payload.targets.map((target: { id: number }) => target.id).sort(),
      rest.slice(0, 3).sort(),
    )
    assert.ok(
      payload.targets.every(
        (target: { status: string; currentLevel: number }) =>
          target.status === 'Okay' && target.currentLevel === 18,
      ),
    )
    assert.equal(payload.poolSize, pool.length)
    assert.ok(payload.checked >= 3 && payload.checked <= 5)
    const skippedIds = payload.skipped.map(
      (player: { id: number }) => player.id,
    )
    for (const id of skippedIds) assert.ok(id === hospital || id === invalid)
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('reports key errors from Torn', async () => {
  const originalFetch = globalThis.fetch
  globalThis.fetch = async () =>
    Response.json({ error: { code: 2, error: 'Incorrect key' } })
  try {
    const response = await invoke('test-key', '?tier=tier1')
    assert.equal(response.status, 401)
    assert.equal((await response.json()).error, 'Incorrect key')
  } finally {
    globalThis.fetch = originalFetch
  }
})

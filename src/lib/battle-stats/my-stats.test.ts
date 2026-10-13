import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  describeBuild,
  effectiveValue,
  parsePersonalStats,
  sampleTimestamps,
} from './my-stats'
import type { StatPoint } from './my-stats'
import { Route as HistoryRoute } from '../../routes/api/(my-stats)/my-stats-history'
import { Route as MyStatsRoute } from '../../routes/api/(my-stats)/my-stats'

const point = (
  strength: number,
  defense: number,
  speed: number,
  dexterity: number,
): StatPoint => ({
  timestamp: 0,
  strength,
  defense,
  speed,
  dexterity,
  total: strength + defense + speed + dexterity,
})

function getHandler(route: typeof HistoryRoute | typeof MyStatsRoute) {
  const handlers = route.options.server?.handlers
  if (!handlers || typeof handlers === 'function' || !handlers.GET)
    throw new Error('Expected a GET handler')
  return handlers.GET
}

async function invoke(
  route: typeof HistoryRoute | typeof MyStatsRoute,
  url: string,
  apiKey: string,
) {
  const response = await getHandler(route)({
    request: new Request(url, { headers: { 'x-torn-api-key': apiKey } }),
  } as never)
  if (!(response instanceof Response)) throw new Error('Expected a response')
  return response
}

test('parses personalstats into a stat point', () => {
  const parsed = parsePersonalStats(
    [
      { name: 'strength', value: 10 },
      { name: 'defense', value: 20 },
      { name: 'speed', value: 30 },
      { name: 'dexterity', value: 40 },
      { name: 'totalstats', value: 100 },
      { name: 'xantaken', value: 5 },
    ],
    1700000000,
  )
  assert.deepEqual(parsed, {
    timestamp: 1700000000,
    strength: 10,
    defense: 20,
    speed: 30,
    dexterity: 40,
    total: 100,
  })
})

test('derives the total and rejects incomplete readings', () => {
  const stats = ['strength', 'defense', 'speed', 'dexterity'].map((name) => ({
    name,
    value: 5,
  }))
  assert.equal(parsePersonalStats(stats, 1)?.total, 20)
  assert.equal(parsePersonalStats(stats.slice(1), 1), null)
  assert.equal(parsePersonalStats(undefined, 1), null)
})

test('applies modifiers to effective values', () => {
  assert.equal(effectiveValue(1000, 25), 1250)
  assert.equal(effectiveValue(1000, -10), 900)
})

test('describes stat builds', () => {
  assert.equal(describeBuild(point(0, 0, 0, 0)).title, 'Fresh recruit')
  assert.equal(describeBuild(point(100, 100, 110, 105)).title, 'Balanced')
  assert.equal(describeBuild(point(300, 100, 300, 100)).title, 'Glass cannon')
  assert.equal(describeBuild(point(100, 300, 100, 300)).title, 'Tank')
  assert.equal(
    describeBuild(point(400, 300, 200, 300)).title,
    'Strength specialist',
  )
  assert.equal(describeBuild(point(300, 100, 300, 100)).offenseShare, 0.75)
})

test('samples the end of each past UTC day', () => {
  const now = Date.UTC(2026, 0, 10, 15) / 1000
  const week = sampleTimestamps('7d', now)
  assert.equal(week.length, 7)
  assert.equal(week.at(-1), Date.UTC(2026, 0, 10) / 1000 - 1)
  assert.ok(week.every((timestamp) => timestamp < now))
  assert.equal(sampleTimestamps('1y', now).length, 52)
})

test('history route rejects missing keys and invalid timestamps', async () => {
  const noKey = await invoke(
    HistoryRoute,
    'http://localhost/api/my-stats-history?timestamp=1',
    '',
  )
  assert.equal(noKey.status, 401)
  for (const timestamp of ['', 'abc', '-5', String(Date.now())]) {
    const response = await invoke(
      HistoryRoute,
      `http://localhost/api/my-stats-history?timestamp=${timestamp}`,
      'history-validation-test',
    )
    assert.equal(response.status, 400, timestamp)
  }
})

test('history route returns the parsed reading', async () => {
  const originalFetch = globalThis.fetch
  let requested: URL | undefined
  globalThis.fetch = async (input) => {
    requested = new URL(String(input))
    return Response.json({
      personalstats: [
        { name: 'strength', value: 1 },
        { name: 'defense', value: 2 },
        { name: 'speed', value: 3 },
        { name: 'dexterity', value: 4 },
      ],
    })
  }
  try {
    const response = await invoke(
      HistoryRoute,
      'http://localhost/api/my-stats-history?timestamp=1700000000',
      'history-success-test',
    )
    assert.equal(response.status, 200)
    assert.equal((await response.json()).point.total, 10)
    assert.equal(requested?.searchParams.get('timestamp'), '1700000000')
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('explains keys without battle stats access', async () => {
  const originalFetch = globalThis.fetch
  globalThis.fetch = async () =>
    Response.json({ error: { code: 16, error: 'Access level too low' } })
  try {
    const response = await invoke(
      MyStatsRoute,
      'http://localhost/api/my-stats',
      'my-stats-access-test',
    )
    assert.equal(response.status, 403)
    assert.match((await response.json()).error, /Limited key/)
  } finally {
    globalThis.fetch = originalFetch
  }
})

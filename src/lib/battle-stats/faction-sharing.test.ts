import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { TestContext } from 'node:test'
import { Route as FactionStatsRoute } from '../../routes/api/(my-stats)/faction-stats'
import { Route as StatSharingRoute } from '../../routes/api/(my-stats)/stat-sharing'
import {
  recordSharedStats,
  statSharingRepository,
} from './faction-sharing.server'
import type { FactionStatsResponse } from './my-stats'

let nextKey = 0
const freshKey = () => `sharing-test-${++nextKey}`

function getHandler(
  route: typeof FactionStatsRoute | typeof StatSharingRoute,
  method: 'GET' | 'POST',
) {
  const handlers = route.options.server?.handlers
  if (!handlers || typeof handlers === 'function')
    throw new Error('Expected object-based route handlers')
  const handler = (handlers as Partial<Record<'GET' | 'POST', unknown>>)[method]
  if (typeof handler !== 'function')
    throw new Error(`Expected a ${method} handler`)
  return handler as (context: unknown) => Promise<unknown>
}

async function invoke(
  route: typeof FactionStatsRoute | typeof StatSharingRoute,
  method: 'GET' | 'POST',
  body?: unknown,
  query = '',
) {
  const response = await getHandler(
    route,
    method,
  )({
    request: new Request(`http://localhost/api/test${query}`, {
      method,
      headers: { 'x-torn-api-key': freshKey() },
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
  })
  if (!(response instanceof Response)) throw new Error('Expected a response')
  return response
}

async function withDatabase(run: () => Promise<void>) {
  const previous = process.env.DATABASE_URL
  process.env.DATABASE_URL = 'postgresql://test'
  try {
    await run()
  } finally {
    if (previous === undefined) delete process.env.DATABASE_URL
    else process.env.DATABASE_URL = previous
  }
}

function mockUpstream(
  context: TestContext,
  {
    factionId = 555,
    ffScouter = [] as unknown,
  }: { factionId?: number; ffScouter?: unknown } = {},
) {
  const requested: string[] = []
  context.mock.method(
    globalThis,
    'fetch',
    async (input: string | URL | Request) => {
      const url = new URL(String(input))
      requested.push(`${url.host}${url.pathname}`)
      if (url.host === 'ffscouter.com') return Response.json(ffScouter)
      if (url.pathname.startsWith('/faction/'))
        return Response.json({
          name: 'Test Faction',
          members: {
            '1': { name: 'Alice', level: 50 },
            '2': { name: 'Bob', level: 60 },
          },
        })
      if (url.pathname === '/v2/user')
        return Response.json({
          battlestats: {
            strength: { value: 10, modifier: 0, modifiers: [] },
            defense: { value: 10, modifier: 0, modifiers: [] },
            speed: { value: 10, modifier: 0, modifiers: [] },
            dexterity: { value: 10, modifier: 0, modifiers: [] },
            total: 40,
          },
        })
      return Response.json({
        player_id: 1,
        name: 'Alice',
        faction: factionId
          ? { faction_id: factionId, faction_name: 'Test Faction' }
          : { faction_id: 0 },
      })
    },
  )
  return requested
}

test('lists faction members with FF Scouter estimates and shared stats for the viewer faction only', async (context) => {
  await withDatabase(async () => {
    mockUpstream(context, {
      ffScouter: [
        {
          player_id: 1,
          fair_fight: 2.1,
          bs_estimate: 5_000_000,
          bs_estimate_human: '5m',
          last_updated: 1700000000,
        },
        { player_id: 2, bs_estimate: null },
      ],
    })
    const loadFaction = context.mock.method(
      statSharingRepository,
      'loadFaction',
      async () => ({
        sharers: [
          {
            playerId: '2',
            playerName: 'Bob',
            factionId: '555',
            updatedAt: new Date(1700000000000),
          },
        ],
        snapshots: [1, 2].map((day) => ({
          playerId: '2',
          timestamp: day * 86_400,
          strength: day * 100,
          defense: day * 100,
          speed: day * 100,
          dexterity: day * 100,
          total: day * 400,
        })),
      }),
    )

    const response = await invoke(
      FactionStatsRoute,
      'GET',
      undefined,
      '?ffscouter=1',
    )
    assert.equal(response.status, 200)
    const payload = (await response.json()) as FactionStatsResponse

    const [factionId, memberIds] = loadFaction.mock.calls[0].arguments
    assert.equal(factionId, '555')
    assert.deepEqual(memberIds, ['1', '2'])
    assert.equal(payload.faction.name, 'Test Faction')
    assert.equal(payload.viewer.id, '1')

    const alice = payload.members.find((member) => member.id === '1')
    const bob = payload.members.find((member) => member.id === '2')
    assert.ok(alice && bob)
    assert.equal(alice.estimate?.human, '5m')
    assert.equal(alice.shared, null)
    assert.equal(bob.estimate, null)
    assert.equal(bob.shared?.current.total, 800)
    assert.equal(bob.shared.history.length, 2)
    assert.equal(payload.members[0].id, '1', 'sorted by best known total')
  })
})

test('still lists members when FF Scouter rejects the key', async (context) => {
  await withDatabase(async () => {
    mockUpstream(context, {
      ffScouter: { code: 6, error: 'Invalid API key' },
    })
    context.mock.method(statSharingRepository, 'loadFaction', async () => ({
      sharers: [],
      snapshots: [],
    }))
    const payload = (await (
      await invoke(FactionStatsRoute, 'GET', undefined, '?ffscouter=1')
    ).json()) as FactionStatsResponse
    assert.equal(payload.members.length, 2)
    assert.match(payload.ffScouterReason ?? '', /ffscouter\.com/)
  })
})

test('does not contact FF Scouter unless the viewer opted in', async (context) => {
  await withDatabase(async () => {
    const requested = mockUpstream(context)
    context.mock.method(statSharingRepository, 'loadFaction', async () => ({
      sharers: [],
      snapshots: [],
    }))
    const response = await invoke(FactionStatsRoute, 'GET')
    assert.equal(response.status, 200)
    assert.ok(requested.every((host) => !host.startsWith('ffscouter.com')))
  })
})

test('refuses to share stats without a faction', async (context) => {
  await withDatabase(async () => {
    mockUpstream(context, { factionId: 0 })
    const enable = context.mock.method(
      statSharingRepository,
      'enable',
      async () => {},
    )
    const response = await invoke(StatSharingRoute, 'POST', { enabled: true })
    assert.equal(response.status, 409)
    assert.equal(enable.mock.callCount(), 0)
  })
})

test('enables sharing for the key owner and records their current stats', async (context) => {
  await withDatabase(async () => {
    mockUpstream(context)
    const enable = context.mock.method(
      statSharingRepository,
      'enable',
      async () => {},
    )
    const record = context.mock.method(
      statSharingRepository,
      'record',
      async () => {},
    )
    const response = await invoke(StatSharingRoute, 'POST', { enabled: true })
    assert.equal(response.status, 200)
    const [owner] = enable.mock.calls[0].arguments as Parameters<
      typeof statSharingRepository.enable
    >
    const [, points] = record.mock.calls[0].arguments as Parameters<
      typeof statSharingRepository.record
    >
    assert.equal(owner.id, '1')
    assert.equal(owner.factionId, '555')
    assert.equal(points[0].total, 40)
  })
})

test('disabling sharing deletes the key owner data', async (context) => {
  await withDatabase(async () => {
    mockUpstream(context)
    const disable = context.mock.method(
      statSharingRepository,
      'disable',
      async () => {},
    )
    const response = await invoke(StatSharingRoute, 'POST', { enabled: false })
    assert.equal(response.status, 200)
    assert.deepEqual(disable.mock.calls[0].arguments, ['1'])
  })
})

test('rejects a sharing update without a boolean', async (context) => {
  await withDatabase(async () => {
    mockUpstream(context)
    const response = await invoke(StatSharingRoute, 'POST', { enabled: 'yes' })
    assert.equal(response.status, 400)
  })
})

test('does not contact Torn to record stats when no database is configured', async (context) => {
  const previous = process.env.DATABASE_URL
  delete process.env.DATABASE_URL
  try {
    const requested = mockUpstream(context)
    await recordSharedStats(freshKey(), [
      {
        timestamp: 1700000000,
        strength: 1,
        defense: 1,
        speed: 1,
        dexterity: 1,
        total: 4,
      },
    ])
    assert.deepEqual(requested, [])
  } finally {
    if (previous !== undefined) process.env.DATABASE_URL = previous
  }
})

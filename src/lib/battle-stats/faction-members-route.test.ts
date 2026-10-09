import assert from 'node:assert/strict'
import { test } from 'node:test'
import { Route } from '../../routes/api/faction-members'
import { sharedEvidenceRepository } from './shared-evidence.server'
import type { SharedObservation } from './shared-evidence.server'
import { travelTrackingRepository } from '../travel.server'
import { observeTravel } from '../travel'
import type { MemberStatus, TravelSnapshot } from '../travel'

const handlers = Route.options.server?.handlers
if (!handlers || typeof handlers === 'function') {
  throw new Error('Expected object-based faction members route handlers')
}
const handler = handlers.GET

let nextKey = 0
async function invokeRoute(key = `faction-test-${++nextKey}`) {
  if (!handler) throw new Error('Missing GET handler')
  const response = await handler({
    request: new Request('http://localhost/api/faction-members?factionId=123', {
      headers: { 'x-torn-api-key': key },
    }),
  } as never)
  if (!(response instanceof Response)) throw new Error('Expected a response')
  return response
}

test('shares captured TBS with another player even when their combat access fails', async (context) => {
  context.mock.timers.enable({ apis: ['Date'], now: Date.now() })
  const originalFetch = globalThis.fetch
  const originalDatabaseUrl = process.env.DATABASE_URL
  process.env.DATABASE_URL = 'postgresql://test'
  context.mock.method(
    travelTrackingRepository,
    'sync',
    async (
      members: Array<{ playerId: string; status: { state?: string } }>,
      observedAt: number,
    ) =>
      new Map(
        members.map((member) => [
          member.playerId,
          observeTravel(member.status, observedAt),
        ]),
      ),
  )
  const saved = new Map<string, SharedObservation>()
  context.mock.method(
    sharedEvidenceRepository,
    'save',
    async (evidence: SharedObservation[]) => {
      for (const item of evidence) {
        if (!saved.has(item.evidenceId))
          saved.set(item.evidenceId, structuredClone(item))
      }
    },
  )
  context.mock.method(sharedEvidenceRepository, 'load', async (ids: string[]) =>
    [...saved.values()].filter((item) => ids.includes(item.playerId)),
  )
  const timestamp = Math.floor(Date.now() / 1000)
  let trained = false
  globalThis.fetch = async (input) => {
    const url = new URL(String(input))
    if (url.pathname.startsWith('/faction/')) {
      return Response.json({
        ID: 123,
        name: 'Test',
        tag: 'T',
        members: {
          456: { name: 'Target', level: 50, status: { state: 'Okay' } },
        },
      })
    }
    if (url.searchParams.get('key') === 'shared-viewer') {
      return Response.json({
        error: { code: 16, error: 'Access level too low' },
      })
    }
    return Response.json({
      player_id: 789,
      name: 'Faction Hitter',
      strength: trained ? 4000000 : 1000000,
      speed: 1000000,
      defense: 1000000,
      dexterity: 1000000,
      attacks: {
        42: {
          attacker_id: 789,
          defender_id: 456,
          timestamp_ended: timestamp,
          result: 'Hospitalized',
          modifiers: { fair_fight: 2 },
        },
        group: {
          attacker_id: 789,
          defender_id: 456,
          timestamp_ended: timestamp,
          result: 'Hospitalized',
          modifiers: { fair_fight: 2, group_attack: 2 },
        },
        undated: {
          attacker_id: 789,
          defender_id: 456,
          result: 'Hospitalized',
          modifiers: { fair_fight: 2 },
        },
        future: {
          attacker_id: 789,
          defender_id: 456,
          timestamp_ended: timestamp + 10000,
          result: 'Hospitalized',
          modifiers: { fair_fight: 2 },
        },
      },
    })
  }
  try {
    const first = await (await invokeRoute('shared-contributor')).json()
    assert.equal(first.sharedTbsStatus, 'READY')
    assert.equal(saved.size, 1)
    trained = true
    context.mock.timers.tick(120001)
    const repeat = await (await invokeRoute('shared-contributor')).json()
    assert.equal(saved.size, 1)
    assert.equal(
      repeat.members[0].battleStats.estimate,
      first.members[0].battleStats.estimate,
    )
    assert.equal(
      repeat.members[0].battleStats.diagnostics.observationsReceived,
      1,
    )
    // The original hit is now outside the personal import window, but stored
    // evidence is still available to a different viewer.
    context.mock.timers.tick(15 * 86400000)
    const viewer = await (await invokeRoute('shared-viewer')).json()
    assert.equal(viewer.fairFightStatus, 'UNAVAILABLE')
    assert.equal(viewer.sharedTbsStatus, 'READY')
    assert.equal(
      viewer.members[0].battleStats.estimate,
      first.members[0].battleStats.estimate,
    )
    assert.equal(
      viewer.members[0].battleStats.newestEvidenceAt,
      timestamp * 1000,
    )
    assert.deepEqual(viewer.members[0].battleStatContributors, [
      { id: '789', name: 'Faction Hitter' },
    ])
  } finally {
    globalThis.fetch = originalFetch
    if (originalDatabaseUrl === undefined) delete process.env.DATABASE_URL
    else process.env.DATABASE_URL = originalDatabaseUrl
  }
})

test('rejects anonymous requests before reading shared evidence', async (context) => {
  const load = context.mock.method(sharedEvidenceRepository, 'load')
  const response = await invokeRoute('')
  assert.equal(response.status, 401)
  assert.equal(load.mock.callCount(), 0)
})

test('serializes landing windows and distinguishes abroad, jail, and active flights', async (context) => {
  context.mock.timers.enable({ apis: ['Date'], now: Date.now() })
  const originalFetch = globalThis.fetch
  const originalDatabaseUrl = process.env.DATABASE_URL
  process.env.DATABASE_URL = 'postgresql://test'
  const snapshots = new Map<string, TravelSnapshot>()
  context.mock.method(
    travelTrackingRepository,
    'sync',
    async (
      members: Array<{ playerId: string; status: MemberStatus }>,
      observedAt: number,
    ) => {
      for (const member of members)
        snapshots.set(
          member.playerId,
          observeTravel(
            member.status,
            observedAt,
            snapshots.get(member.playerId),
          ),
        )
      return snapshots
    },
  )
  context.mock.method(sharedEvidenceRepository, 'save', async () => {})
  context.mock.method(sharedEvidenceRepository, 'load', async () => [])
  let departing = false
  globalThis.fetch = async (input) => {
    const url = new URL(String(input))
    if (url.pathname.startsWith('/faction/')) {
      return Response.json({
        ID: 123,
        name: 'Test',
        tag: 'T',
        members: {
          801001: {
            name: 'Returning',
            level: 50,
            status: departing
              ? {
                  state: 'Traveling',
                  description: 'Returning from Canada',
                  until: null,
                }
              : { state: 'Abroad', description: 'In Canada' },
          },
          801002: {
            name: 'Abroad',
            level: 50,
            status: { state: 'Abroad', description: 'In Japan' },
          },
          801003: {
            name: 'Jailed',
            level: 50,
            status: { state: 'Jail', until: Date.now() / 1000 + 600 },
          },
        },
      })
    }
    return Response.json({ error: { code: 16, error: 'Access level too low' } })
  }
  try {
    const before = await (await invokeRoute('flight-route-test')).json()
    departing = true
    context.mock.timers.tick(30000)
    const after = await (await invokeRoute('flight-route-test')).json()
    const returning = after.members.find(
      (member: { id: string }) => member.id === '801001',
    )
    assert.equal(returning.status, 'Traveling')
    assert.equal(returning.travel.direction, 'RETURNING')
    assert.equal(returning.travel.country, 'Canada')
    assert.equal(returning.travel.departureObserved, true)
    assert.equal(returning.travel.firstSeenAt, after.statusObservedAt)
    assert.equal(
      returning.travel.earliestArrivalAt,
      before.statusObservedAt + 9 * 0.97 * 60000,
    )
    assert.equal(
      returning.travel.latestArrivalAt,
      after.statusObservedAt + 39 * 1.03 * 60000,
    )
    const abroad = after.members.find(
      (member: { id: string }) => member.id === '801002',
    )
    const jailed = after.members.find(
      (member: { id: string }) => member.id === '801003',
    )
    assert.equal(abroad.status, 'Abroad')
    assert.equal(abroad.travel, null)
    assert.equal(jailed.status, 'Unavailable')
    assert.equal(jailed.travel, null)
    const cached = await (await invokeRoute('flight-route-test')).json()
    assert.equal(cached.statusObservedAt, after.statusObservedAt)
    assert.deepEqual(cached.members[0].travel, returning.travel)
  } finally {
    globalThis.fetch = originalFetch
    if (originalDatabaseUrl === undefined) delete process.env.DATABASE_URL
    else process.env.DATABASE_URL = originalDatabaseUrl
  }
})

test('serializes an FF estimate from flat v1 battle stats', async () => {
  assert.equal(typeof handler, 'function')
  const originalFetch = globalThis.fetch
  const now = Math.floor(Date.now() / 1000)
  let calls = 0
  globalThis.fetch = async () => {
    calls++
    return Response.json(
      calls === 1
        ? {
            ID: 123,
            name: 'Test faction',
            tag: 'TEST',
            members: {
              456: {
                name: 'Target',
                level: 50,
                status: { state: 'Okay' },
                last_action: { relative: 0 },
              },
            },
          }
        : {
            player_id: 789,
            strength: '1,000,000',
            speed: '1,000,000',
            defense: '1,000,000',
            dexterity: '1,000,000',
            attacks: {
              1: {
                attacker_id: 789,
                defender_id: 456,
                timestamp_ended: now,
                result: 'Hospitalized',
                modifiers: { fair_fight: 2 },
              },
            },
          },
    )
  }
  try {
    const response = await invokeRoute()
    const payload = await response.json()
    assert.equal(payload.fairFightStatus, 'READY')
    assert.equal(payload.members[0].battleStats.sources[0], 'FAIR_FIGHT')
    assert.ok(payload.members[0].battleStats.estimate > 0)
    assert.equal(payload.members[0].hospitalRecommended, true)
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('reports the Torn error instead of blaming key permissions', async () => {
  assert.equal(typeof handler, 'function')
  const originalFetch = globalThis.fetch
  let calls = 0
  globalThis.fetch = async () => {
    calls++
    return Response.json(
      calls === 1
        ? { ID: 123, name: 'Test faction', tag: 'TEST', members: {} }
        : { error: { code: 5, error: 'Too many requests' } },
    )
  }
  try {
    const response = await invokeRoute()
    const payload = await response.json()
    assert.equal(payload.fairFightStatus, 'UNAVAILABLE')
    assert.match(payload.fairFightReason, /Too many requests/)
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('refreshes hospital status while reusing slower-changing combat evidence', async (context) => {
  context.mock.timers.enable({ apis: ['Date'], now: Date.now() })
  const originalFetch = globalThis.fetch
  let factionCalls = 0
  let combatCalls = 0
  globalThis.fetch = async (input) => {
    const url = new URL(String(input))
    if (url.pathname.startsWith('/faction/')) {
      factionCalls++
      return Response.json({
        ID: 123,
        name: 'Test faction',
        tag: 'TEST',
        members: {},
      })
    }
    combatCalls++
    return Response.json({
      player_id: 789,
      strength: 100,
      speed: 100,
      defense: 100,
      dexterity: 100,
      attacks: {},
    })
  }
  try {
    await invokeRoute('evidence-cache-key')
    context.mock.timers.tick(30000)
    await invokeRoute('evidence-cache-key')
    assert.equal(factionCalls, 2)
    assert.equal(combatCalls, 1)
    context.mock.timers.tick(90000)
    await invokeRoute('evidence-cache-key')
    assert.equal(factionCalls, 3)
    assert.equal(combatCalls, 2)
  } finally {
    globalThis.fetch = originalFetch
  }
})

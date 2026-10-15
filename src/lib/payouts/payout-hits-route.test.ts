import assert from 'node:assert/strict'
import test from 'node:test'
import { Route } from '../../routes/api/(payouts)/payout-hits'
import type { PayoutPlayersResponse } from '#/models/payouts'
import type { TornFactionAttack } from '#/models/torn'

const handlers = Route.options.server?.handlers
if (!handlers || typeof handlers === 'function' || !handlers.GET)
  throw new Error('Expected payout GET handler')
const handler = handlers.GET

async function invoke(key?: string, query = '?warId=501') {
  const response = await handler({
    request: new Request(`http://localhost/api/payout-hits${query}`, {
      headers: key ? { 'X-Torn-Api-Key': key } : {},
    }),
  } as never)
  if (!(response instanceof Response)) throw new Error('Expected response')
  assert.equal(response.headers.get('Cache-Control'), 'no-store')
  return response
}

function attack(
  id: number,
  overrides: Partial<TornFactionAttack> = {},
): TornFactionAttack {
  return {
    id,
    ended: 1400,
    attacker: { id: 42, name: 'Player', faction: { id: 7 } },
    result: 'Hospitalized',
    chain: 12,
    is_interrupted: false,
    is_ranked_war: false,
    ...overrides,
  }
}

function report() {
  return {
    rankedwarreport: {
      start: 1000,
      end: 2000,
      factions: [{ id: 7, members: [{ id: 42, name: 'Player', attacks: 10 }] }],
    },
  }
}

test('payouts require a key and validate war IDs before contacting Torn', async (context) => {
  const mock = context.mock.method(globalThis, 'fetch', async () => {
    throw new Error('Unexpected request')
  })
  assert.equal((await invoke()).status, 401)
  assert.equal((await invoke('payout-invalid', '?warId=abc')).status, 400)
  assert.equal(mock.mock.callCount(), 0)
})

test('uses real member IDs and loads outside chain hits beyond the first 100 attacks', async (context) => {
  let pages = 0
  context.mock.method(
    globalThis,
    'fetch',
    async (input: string | URL | Request) => {
      const url = new URL(String(input))
      if (url.pathname === '/user/')
        return Response.json({ faction: { faction_id: 7 } })
      if (url.pathname.endsWith('/rankedwarreport'))
        return Response.json(report())
      assert.equal(url.pathname, '/v2/faction/attacks')
      assert.equal(url.searchParams.get('filters'), 'outgoing')
      assert.equal(url.searchParams.get('from'), '1000')
      pages += 1
      if (pages === 1) {
        assert.equal(url.searchParams.get('to'), '2000')
        return Response.json({
          attacks: Array.from({ length: 100 }, (_, i) =>
            attack(i + 1, { is_ranked_war: true }),
          ),
          _metadata: {
            links: {
              next: 'https://api.torn.com/v2/faction/attacks?from=1000&to=1500',
            },
          },
        })
      }
      assert.equal(url.searchParams.get('to'), '1500')
      return Response.json({
        attacks: [
          attack(101),
          attack(101),
          attack(102, {
            attacker: { id: 99, name: 'Outside only', faction: { id: 7 } },
          }),
          attack(103, { result: 'Lost' }),
          attack(104, { result: 'Assist' }),
          attack(105, { is_interrupted: true }),
          attack(106, { chain: 0 }),
          attack(107, { chain: null }),
          attack(108, { ended: 999 }),
          attack(109, { ended: 2001 }),
          attack(110, {
            attacker: { id: 42, name: 'Other faction', faction: { id: 8 } },
          }),
          attack(111, { attacker: null }),
        ],
        _metadata: { links: { next: null } },
      })
    },
  )
  const response = await invoke('payout-pagination')
  assert.equal(response.status, 200)
  const payload = (await response.json()) as PayoutPlayersResponse
  assert.deepEqual(payload.players, [
    { id: '42', name: 'Player', warHits: 10, nonWarHits: 1 },
    { id: '99', name: 'Outside only', warHits: 0, nonWarHits: 1 },
  ])
  assert.equal(pages, 2)
})

test('does not return partial payouts or send a key to an external pagination link', async (context) => {
  for (const next of [
    'https://example.com/steal',
    'https://api.torn.com/v2/faction/attacks?from=1000&to=2000&limit=100&filters=outgoing',
  ]) {
    context.mock.method(
      globalThis,
      'fetch',
      async (input: string | URL | Request) => {
        const url = new URL(String(input))
        assert.equal(url.origin, 'https://api.torn.com')
        if (url.pathname === '/user/')
          return Response.json({ faction: { faction_id: 7 } })
        if (url.pathname.endsWith('/rankedwarreport'))
          return Response.json(report())
        return Response.json({
          attacks: [attack(1)],
          _metadata: { links: { next } },
        })
      },
    )
    const response = await invoke(`payout-unsafe-${next.includes('example')}`)
    assert.equal(response.status, 502)
    const payload = (await response.json()) as {
      error: string
      players?: unknown
    }
    assert.ok(payload.error)
    assert.equal(payload.players, undefined)
  }
})

test('surfaces Torn key errors instead of showing incomplete outside hit counts', async (context) => {
  context.mock.method(
    globalThis,
    'fetch',
    async (input: string | URL | Request) => {
      const url = new URL(String(input))
      if (url.pathname === '/user/')
        return Response.json({ faction: { faction_id: 7 } })
      if (url.pathname.endsWith('/rankedwarreport'))
        return Response.json(report())
      return Response.json({ error: { code: 2, error: 'Incorrect key' } })
    },
  )
  const response = await invoke('payout-key-error')
  assert.equal(response.status, 502)
  assert.deepEqual(await response.json(), { error: 'Incorrect key' })
})

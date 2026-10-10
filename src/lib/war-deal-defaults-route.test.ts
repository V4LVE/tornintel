import assert from 'node:assert/strict'
import test from 'node:test'
import type { TestContext } from 'node:test'
import { Route } from '../routes/api/war-deal-defaults'

const handlers = Route.options.server?.handlers
if (!handlers || typeof handlers === 'function' || !handlers.GET)
  throw new Error('Expected defaults GET handler')
const handler = handlers.GET

async function invoke(key?: string, query = '') {
  const response = await handler({
    request: new Request(`http://localhost/api/war-deal-defaults${query}`, {
      headers: key ? { 'X-Torn-Api-Key': key } : {},
    }),
  } as never)
  if (!(response instanceof Response)) throw new Error('Expected response')
  return { status: response.status, data: await response.json() }
}

test('requires a key and validates opponent IDs before contacting Torn', async (context) => {
  const mock = context.mock.method(globalThis, 'fetch', async () => {
    throw new Error('Unexpected fetch')
  })
  assert.equal((await invoke()).status, 401)
  assert.equal(
    (await invoke('invalid-opponent', '?opponentId=abc')).status,
    400,
  )
  assert.equal(mock.mock.callCount(), 0)
})

function mockTorn(context: TestContext, priceFailure = false) {
  context.mock.method(
    globalThis,
    'fetch',
    async (input: string | URL | Request) => {
      const url = new URL(String(input))
      switch (url.pathname) {
        case '/v2/faction/basic':
          return Response.json({ basic: { id: 1, name: 'NPC' } })
        case '/v2/faction/3/basic':
          return Response.json({ basic: { id: 3, name: 'Different opponent' } })
        case '/v2/faction/3/rankedwars':
          return Response.json({ rankedwars: [] })
        case '/v2/faction/wars':
          return Response.json({
            wars: {
              ranked: {
                war_id: 50,
                target: 5500,
                start: 1800000000,
                factions: [
                  { id: 1, name: 'NPC' },
                  { id: 2, name: 'Enemy' },
                ],
              },
            },
          })
        case '/v2/torn/items':
          return Response.json(
            priceFailure
              ? { error: { error: 'Access level too low', code: 16 } }
              : {
                  items: [
                    {
                      id: 100,
                      name: 'Armor Cache',
                      value: { market_price: 200000000 },
                    },
                    {
                      id: 101,
                      name: 'Melee Cache',
                      value: { market_price: 100000000 },
                    },
                    { id: 206, name: 'Xanax', value: { market_price: 800000 } },
                  ],
                },
          )
        case '/v2/faction/1/rankedwars':
        case '/v2/faction/2/rankedwars':
          return Response.json({
            rankedwars: [
              { id: 50, end: 0 },
              { id: 40, end: 1700000000 },
            ],
          })
        case '/v2/faction/40/rankedwarreport':
          return Response.json({
            rankedwarreport: {
              id: 40,
              end: 1700000000,
              winner: 1,
              factions: [
                {
                  id: 1,
                  name: 'NPC',
                  rewards: {
                    items: [{ id: 100, name: 'Armor Cache', quantity: 4 }],
                  },
                },
                {
                  id: 2,
                  name: 'Enemy',
                  rewards: {
                    items: [{ id: 101, name: 'Melee Cache', quantity: 2 }],
                  },
                },
              ],
            },
          })
        default:
          throw new Error(`Unexpected path ${url.pathname}`)
      }
    },
  )
}

test('serializes detected war, faction names, item prices, and completed reward baselines', async (context) => {
  mockTorn(context)
  const { status, data } = await invoke('defaults-success')
  assert.equal(status, 200)
  assert.equal(data.ourFaction.name, 'NPC')
  assert.equal(data.theirFaction.name, 'Enemy')
  assert.deepEqual(data.war, { id: 50, target: 5500, start: 1800000000 })
  assert.deepEqual(data.caches[0], {
    name: 'Armor',
    ours: 4,
    theirs: 0,
    price: 200000000,
  })
  assert.deepEqual(data.caches[1], {
    name: 'Melee',
    ours: 0,
    theirs: 2,
    price: 100000000,
  })
  assert.equal(
    data.items.find((item: { name: string }) => item.name === 'Xanax').price,
    800000,
  )
  assert.equal(data.baselines.length, 2)
  assert.ok(
    data.baselines.every(
      (baseline: { warId: number }) => baseline.warId === 40,
    ),
  )
  assert.deepEqual(data.warnings, [])
})

test('price permission errors retain faction and reward data with an explicit warning', async (context) => {
  mockTorn(context, true)
  const { status, data } = await invoke('defaults-no-prices')
  assert.equal(status, 200)
  assert.equal(data.caches[0].ours, 4)
  assert.equal(data.caches[0].price, 0)
  assert.deepEqual(data.items, [])
  assert.match(
    data.warnings.join(' '),
    /Item prices unavailable: Access level too low/,
  )
})

test('a different opponent does not inherit the current war target or another faction reward', async (context) => {
  mockTorn(context)
  const { status, data } = await invoke(
    'defaults-other-opponent',
    '?opponentId=3',
  )
  assert.equal(status, 200)
  assert.equal(data.theirFaction.name, 'Different opponent')
  assert.equal(data.war, null)
  assert.ok(
    data.caches.every((cache: { theirs: number }) => cache.theirs === 0),
  )
  assert.match(data.warnings.join(' '), /No completed war found/)
})

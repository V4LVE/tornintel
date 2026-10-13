import assert from 'node:assert/strict'
import { test } from 'node:test'
import { resolveEnemyFaction } from './enemy-faction.server'
import { Route } from '../../routes/api/(war-hospital)/faction-members'

const OWN = { id: 100, name: 'Us' }

type Responses = {
  basic?: unknown
  wars?: unknown
  rankedwars?: unknown
}

async function withTorn(
  responses: Responses,
  run: (calls: string[]) => Promise<void>,
) {
  const originalFetch = globalThis.fetch
  const originalDefault = process.env.TORN_ENEMY_FACTION_ID
  const calls: string[] = []
  globalThis.fetch = async (input) => {
    const url = new URL(String(input))
    calls.push(url.pathname)
    const body =
      url.pathname === '/v2/faction/basic'
        ? responses.basic
        : url.pathname === '/v2/faction/wars'
          ? responses.wars
          : url.pathname === '/v2/faction/rankedwars'
            ? responses.rankedwars
            : undefined
    return Response.json(
      body ?? { error: { code: 6, error: 'Incorrect ID-entity relation' } },
    )
  }
  try {
    await run(calls)
  } finally {
    globalThis.fetch = originalFetch
    if (originalDefault === undefined) delete process.env.TORN_ENEMY_FACTION_ID
    else process.env.TORN_ENEMY_FACTION_ID = originalDefault
  }
}

test('tracks the opponent in the current ranked war', async () => {
  await withTorn(
    {
      basic: { basic: OWN },
      wars: {
        wars: {
          ranked: {
            id: 1,
            start: 0,
            end: 0,
            factions: [OWN, { id: 200, name: 'Them' }],
          },
        },
      },
    },
    async (calls) => {
      assert.deepEqual(await resolveEnemyFaction('current-war-key'), {
        id: '200',
        source: 'current-war',
      })
      assert.ok(!calls.includes('/v2/faction/rankedwars'))
    },
  )
})

test('falls back to the most recently finished ranked war', async () => {
  const war = (id: number, end: number, opponent: number) => ({
    id,
    start: end - 1,
    end,
    factions: [{ id: opponent, name: 'Other' }, OWN],
  })
  await withTorn(
    {
      basic: { basic: OWN },
      wars: { wars: { ranked: null } },
      rankedwars: {
        rankedwars: [war(1, 500, 301), war(2, 900, 302), war(3, 0, 303)],
      },
    },
    async () => {
      assert.deepEqual(await resolveEnemyFaction('last-war-key'), {
        id: '302',
        source: 'last-war',
      })
    },
  )
})

test('uses the server default when no war is found or lookups fail', async () => {
  await withTorn({}, async () => {
    process.env.TORN_ENEMY_FACTION_ID = '56833'
    assert.deepEqual(await resolveEnemyFaction('no-faction-key'), {
      id: '56833',
      source: 'default',
    })
    process.env.TORN_ENEMY_FACTION_ID = 'not-a-number'
    assert.equal(await resolveEnemyFaction('no-faction-key-2'), null)
  })
})

test('faction members asks for a faction ID when none can be resolved', async () => {
  const handlers = Route.options.server?.handlers
  if (!handlers || typeof handlers === 'function' || !handlers.GET) {
    throw new Error('Expected a faction members GET handler')
  }
  const handler = handlers.GET
  await withTorn(
    { basic: { basic: OWN }, wars: { wars: { ranked: null } }, rankedwars: {} },
    async (calls) => {
      delete process.env.TORN_ENEMY_FACTION_ID
      const response = await handler({
        request: new Request('http://localhost/api/faction-members', {
          headers: { 'x-torn-api-key': 'unresolved-key' },
        }),
      } as never)
      if (!(response instanceof Response)) throw new Error('Expected response')
      assert.equal(response.status, 404)
      assert.match((await response.json()).error, /Enter a faction ID/)
      assert.ok(!calls.some((path) => path.startsWith('/faction/')))
    },
  )
})

test('reports an invalid key instead of using the default faction', async () => {
  const originalFetch = globalThis.fetch
  globalThis.fetch = async () =>
    Response.json({ error: { code: 2, error: 'Incorrect key' } })
  try {
    process.env.TORN_ENEMY_FACTION_ID = '56833'
    await assert.rejects(resolveEnemyFaction('broken-key'), /Incorrect key/)
  } finally {
    globalThis.fetch = originalFetch
    delete process.env.TORN_ENEMY_FACTION_ID
  }
})

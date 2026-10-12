import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createFfScouterClient, FfScouterError } from './ffscouter.server'
import type { LevellingListChange } from './levelling'
import { bundledPlayers, levellingListRepository } from './levelling.server'
import { Route as DiscoverRoute } from '../routes/api/levelling-discover'
import { Route as EstimatesRoute } from '../routes/api/levelling-estimates'
import { Route as KeyRoute } from '../routes/api/ffscouter-key'
import { Route as ListRoute } from '../routes/api/levelling-list'

function handlerFor(route: { options: { server?: { handlers?: unknown } } }) {
  const handlers = route.options.server?.handlers as
    Record<string, (context: never) => Promise<Response>> | undefined
  if (!handlers) throw new Error('Expected route handlers')
  return async (method: string, path: string, init: RequestInit = {}) =>
    handlers[method]({
      request: new Request('http://localhost' + path, { method, ...init }),
    } as never)
}

const keyHeader = { 'x-torn-api-key': 'test-key' }

function stats(id: number, total: number | null) {
  return {
    player_id: id,
    fair_fight: total === null ? null : 1.1,
    bs_estimate: total,
    bs_estimate_human: total === null ? null : `${total}`,
    last_updated: 1700000000,
  }
}

async function withFetch(
  fake: (url: URL) => Response | Promise<Response>,
  run: () => Promise<void>,
) {
  const originalFetch = globalThis.fetch
  globalThis.fetch = async (input) => fake(new URL(String(input)))
  try {
    await run()
  } finally {
    globalThis.fetch = originalFetch
  }
}

test('batches estimate requests, caches per key and keeps missing estimates', async () => {
  const client = createFfScouterClient()
  const requests: string[][] = []
  await withFetch(
    (url) => {
      assert.equal(url.pathname, '/api/v1/get-stats')
      const ids = url.searchParams.get('targets')!.split(',')
      requests.push(ids)
      return Response.json(
        ids.map((id) => stats(Number(id), id === '3' ? null : 1000)),
      )
    },
    async () => {
      const ids = Array.from({ length: 210 }, (_, index) => index + 1)
      const first = await client.getEstimates('key-a', ids)
      assert.deepEqual(
        requests.map((batch) => batch.length),
        [205, 5],
      )
      assert.equal(first.get(1)?.total, 1000)
      assert.equal(first.get(1)?.updatedAt, 1700000000000)
      assert.equal(first.get(3), null)
      await client.getEstimates('key-a', [1, 2, 3])
      assert.equal(requests.length, 2)
      // Fair fight is relative to the key owner, so other keys fetch again.
      await client.getEstimates('key-b', [1])
      assert.equal(requests.length, 3)
    },
  )
})

test('explains unregistered FF Scouter keys', async () => {
  const client = createFfScouterClient()
  await withFetch(
    () =>
      Response.json(
        { code: 6, error: 'Invalid API key. Please sign up' },
        { status: 401 },
      ),
    async () => {
      await assert.rejects(
        client.getEstimates('key', [1]),
        (error: unknown) =>
          error instanceof FfScouterError &&
          error.status === 401 &&
          /registered with FF Scouter/.test(error.message),
      )
    },
  )
})

test('estimates route validates input and passes on FF Scouter key errors', async () => {
  const invoke = handlerFor(EstimatesRoute)
  assert.equal(
    (await invoke('GET', '/api/levelling-estimates?ids=1')).status,
    401,
  )
  assert.equal(
    (
      await invoke('GET', '/api/levelling-estimates?ids=abc', {
        headers: keyHeader,
      })
    ).status,
    400,
  )
  await withFetch(
    () => Response.json({ code: 6, error: 'Invalid API key' }, { status: 401 }),
    async () => {
      const response = await invoke(
        'GET',
        '/api/levelling-estimates?ids=987654321',
        { headers: keyHeader },
      )
      assert.equal(response.status, 401)
      assert.match((await response.json()).error, /FF Scouter/)
    },
  )
})

test('discover route searches the tier and marks players already listed', async () => {
  const invoke = handlerFor(DiscoverRoute)
  const listed = bundledPlayers.find(
    (player) => player.level >= 21 && player.level <= 30,
  )!
  await withFetch(
    (url) => {
      assert.equal(url.pathname, '/api/v1/get-targets')
      assert.equal(url.searchParams.get('minlevel'), '21')
      assert.equal(url.searchParams.get('maxlevel'), '30')
      assert.equal(url.searchParams.get('maxff'), '1.25')
      assert.equal(url.searchParams.get('inactiveonly'), '0')
      return Response.json({
        parameters: {},
        targets: [
          {
            ...stats(900001, null),
            name: 'Unknown',
            level: 15,
            last_action: null,
          },
          { ...stats(900002, 5000), name: 'Strong', level: 16, last_action: 1 },
          {
            ...stats(listed.id, 100),
            name: listed.name,
            level: 15,
            last_action: 1,
          },
        ],
      })
    },
    async () => {
      const response = await invoke(
        'GET',
        '/api/levelling-discover?tier=tier3&maxff=1.25&inactive=0',
        { headers: keyHeader },
      )
      assert.equal(response.status, 200)
      const { players } = await response.json()
      assert.deepEqual(
        players.map((player: { id: number; onList: boolean }) => [
          player.id,
          player.onList,
        ]),
        [
          [listed.id, true],
          [900002, false],
          [900001, false],
        ],
      )
    },
  )
  const invalid = await invoke(
    'GET',
    '/api/levelling-discover?tier=tier3&maxff=9',
    { headers: keyHeader },
  )
  assert.equal(invalid.status, 400)
})

test('list route serves the bundled lists and refuses changes without storage', async () => {
  const invoke = handlerFor(ListRoute)
  const savedUrl = process.env.DATABASE_URL
  delete process.env.DATABASE_URL
  try {
    const list = await invoke('GET', '/api/levelling-list')
    const payload = await list.json()
    assert.equal(payload.players.length, bundledPlayers.length)
    assert.match(payload.warning, /not configured/)

    const post = (body: unknown, headers: Record<string, string> = keyHeader) =>
      invoke('POST', '/api/levelling-list', {
        headers: { ...headers, 'content-type': 'application/json' },
        body: JSON.stringify(body),
      })
    assert.equal((await post({ playerId: 1, action: 'add' }, {})).status, 401)
    assert.equal((await post({ playerId: 'x', action: 'add' })).status, 400)
    assert.equal((await post({ playerId: 1, action: 'drop' })).status, 400)
    assert.equal((await post({ playerId: 1, action: 'add' })).status, 503)
  } finally {
    if (savedUrl !== undefined) process.env.DATABASE_URL = savedUrl
  }
})

test('list route records changes using identities verified by Torn', async () => {
  const invoke = handlerFor(ListRoute)
  const savedUrl = process.env.DATABASE_URL
  const { load, save } = levellingListRepository
  const changes: (LevellingListChange & { changedById: number })[] = []
  process.env.DATABASE_URL = 'postgres://test'
  levellingListRepository.load = async () => changes
  levellingListRepository.save = async (change) => {
    const index = changes.findIndex((item) => item.playerId === change.playerId)
    if (index === -1) changes.push(change)
    else changes[index] = change
  }
  const removed = bundledPlayers[0]
  try {
    await withFetch(
      (url) => {
        if (url.hostname === 'ffscouter.com')
          return Response.json([stats(777001, 250)])
        const id = url.pathname.replace('/user/', '')
        return Response.json(
          id
            ? { player_id: 777001, name: 'Fresh', level: 18 }
            : { player_id: 42, name: 'Editor', level: 50 },
        )
      },
      async () => {
        const post = (body: unknown) =>
          invoke('POST', '/api/levelling-list', {
            headers: { ...keyHeader, 'content-type': 'application/json' },
            body: JSON.stringify(body),
          })
        const added = await post({
          playerId: 777001,
          action: 'add',
          name: 'Spoofed',
          addedById: 1,
        })
        assert.equal(added.status, 200)
        const addedPlayer = (await added.json()).players.find(
          (player: { id: number }) => player.id === 777001,
        )
        assert.deepEqual(
          {
            name: addedPlayer.name,
            level: addedPlayer.level,
            total: addedPlayer.total,
            addedBy: addedPlayer.addedBy,
          },
          {
            name: 'Fresh',
            level: 18,
            total: 250,
            addedBy: { id: 42, name: 'Editor' },
          },
        )
        assert.equal(
          (await post({ playerId: 777001, action: 'add' })).status,
          409,
        )

        const response = await post({ playerId: removed.id, action: 'remove' })
        assert.equal(response.status, 200)
        const { players } = await response.json()
        assert.ok(
          !players.some((player: { id: number }) => player.id === removed.id),
        )
        assert.equal(
          changes.find((item) => item.playerId === removed.id)?.changedById,
          42,
        )
        assert.equal(
          (await post({ playerId: removed.id, action: 'remove' })).status,
          404,
        )
      },
    )
  } finally {
    levellingListRepository.load = load
    levellingListRepository.save = save
    if (savedUrl === undefined) delete process.env.DATABASE_URL
    else process.env.DATABASE_URL = savedUrl
  }
})

test('uses a separate FF Scouter key when one is sent', async () => {
  const invoke = handlerFor(EstimatesRoute)
  const keys: (string | null)[] = []
  await withFetch(
    (url) => {
      keys.push(url.searchParams.get('key'))
      return Response.json([stats(555001, 100)])
    },
    async () => {
      const separate = await invoke(
        'GET',
        '/api/levelling-estimates?ids=555001',
        {
          headers: {
            'x-torn-api-key': 'torn-key-0000000',
            'x-ffscouter-key': 'ffsc-key-0000000',
          },
        },
      )
      assert.equal(separate.status, 200)
      const onlyFf = await invoke(
        'GET',
        '/api/levelling-estimates?ids=555002',
        {
          headers: { 'x-ffscouter-key': 'ffsc-only-000000' },
        },
      )
      assert.equal(onlyFf.status, 200)
      assert.deepEqual(keys, ['ffsc-key-0000000', 'ffsc-only-000000'])
    },
  )
})

test('checks whether an FF Scouter key is registered', async () => {
  const invoke = handlerFor(KeyRoute)
  const check = (key?: string) =>
    invoke('GET', '/api/ffscouter-key', {
      headers: key ? { 'x-ffscouter-key': key } : {},
    })
  assert.equal((await check()).status, 400)
  assert.equal((await check('too-short')).status, 400)
  await withFetch(
    (url) => {
      assert.equal(url.pathname, '/api/v1/check-key')
      return Response.json({
        key: url.searchParams.get('key'),
        is_registered: url.searchParams.get('key') === 'Registered000000',
        is_premium: false,
      })
    },
    async () => {
      assert.deepEqual(await (await check('Registered000000')).json(), {
        registered: true,
        premium: false,
      })
      assert.deepEqual(await (await check('Unknown000000000')).json(), {
        registered: false,
        premium: false,
      })
    },
  )
})

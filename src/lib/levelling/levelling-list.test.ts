import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  bundledPlayers,
  isLevellingEditor,
  levellingListRepository,
} from './levelling.server'
import { Route } from '../../routes/api/(levelling)/levelling-list'
import type { LevellingListChange } from '#/models/levelling'

const handlers = Route.options.server?.handlers as
  | Partial<Record<'GET' | 'POST', (context: never) => Promise<Response>>>
  | undefined
if (!handlers?.GET || !handlers.POST) {
  throw new Error('Expected levelling list GET and POST handlers')
}
const routeHandlers = { GET: handlers.GET, POST: handlers.POST }

type StoredChange = LevellingListChange & { changedById: number }

// Each key is a different Torn account; the faction decides editor access too.
const ACCOUNTS: Partial<
  Record<string, { id: number; name: string; faction: number }>
> = {
  'editor-key': { id: 42, name: 'Editor', faction: 900 },
  'stranger-key': { id: 66, name: 'Stranger', faction: 901 },
  'faction-key': { id: 77, name: 'Factionmate', faction: 555 },
}

const NEW_PLAYER = 777001

async function withListEnvironment(
  run: (helpers: {
    changes: StoredChange[]
    request: (
      key: string,
      method: 'GET' | 'POST',
      body?: unknown,
    ) => Promise<Response>
  }) => Promise<void>,
) {
  const originalFetch = globalThis.fetch
  const saved = {
    url: process.env.DATABASE_URL,
    ids: process.env.LEVELLING_EDITOR_IDS,
    factions: process.env.LEVELLING_EDITOR_FACTION_IDS,
  }
  const { load, save } = levellingListRepository
  const changes: StoredChange[] = []
  process.env.DATABASE_URL = 'postgres://test'
  process.env.LEVELLING_EDITOR_IDS = '42'
  process.env.LEVELLING_EDITOR_FACTION_IDS = '555'
  levellingListRepository.load = async () => changes
  levellingListRepository.save = async (change) => {
    const index = changes.findIndex((item) => item.playerId === change.playerId)
    if (index === -1) changes.push(change)
    else changes[index] = change
  }
  globalThis.fetch = async (input) => {
    const url = new URL(String(input))
    if (url.hostname === 'ffscouter.com') {
      return Response.json([
        { player_id: NEW_PLAYER, bs_estimate: 250, last_updated: 1 },
      ])
    }
    const id = url.pathname.replace('/user/', '')
    if (id) {
      return Response.json({
        player_id: Number(id),
        name: `Player ${id}`,
        level: 18,
      })
    }
    const account = ACCOUNTS[url.searchParams.get('key') ?? '']
    if (!account) {
      return Response.json({ error: { code: 2, error: 'Incorrect key' } })
    }
    assert.equal(url.searchParams.get('selections'), 'profile')
    return Response.json({
      player_id: account.id,
      name: account.name,
      level: 50,
      faction: { faction_id: account.faction },
    })
  }
  try {
    await run({
      changes,
      request: (key, method, body) =>
        routeHandlers[method]({
          request: new Request('http://localhost/api/levelling-list', {
            method,
            headers: {
              ...(key ? { 'x-torn-api-key': key } : {}),
              ...(body === undefined
                ? {}
                : { 'content-type': 'application/json' }),
            },
            body: body === undefined ? undefined : JSON.stringify(body),
          }),
        } as never),
    })
  } finally {
    globalThis.fetch = originalFetch
    levellingListRepository.load = load
    levellingListRepository.save = save
    setEnv('DATABASE_URL', saved.url)
    setEnv('LEVELLING_EDITOR_IDS', saved.ids)
    setEnv('LEVELLING_EDITOR_FACTION_IDS', saved.factions)
  }
}

function withEditorEnv(
  env: { ids: string | undefined; factions: string | undefined },
  run: () => void,
) {
  const saved = {
    ids: process.env.LEVELLING_EDITOR_IDS,
    factions: process.env.LEVELLING_EDITOR_FACTION_IDS,
  }
  setEnv('LEVELLING_EDITOR_IDS', env.ids)
  setEnv('LEVELLING_EDITOR_FACTION_IDS', env.factions)
  try {
    run()
  } finally {
    setEnv('LEVELLING_EDITOR_IDS', saved.ids)
    setEnv('LEVELLING_EDITOR_FACTION_IDS', saved.factions)
  }
}

function setEnv(name: string, value: string | undefined) {
  if (value === undefined) delete process.env[name]
  else process.env[name] = value
}

test('editors match configured player or faction IDs only', () => {
  withEditorEnv({ ids: ' 42 , 43,', factions: '555' }, () => {
    assert.equal(isLevellingEditor({ id: 42, factionId: null }), true)
    assert.equal(isLevellingEditor({ id: 43, factionId: 901 }), true)
    assert.equal(isLevellingEditor({ id: 7, factionId: 555 }), true)
    assert.equal(isLevellingEditor({ id: 7, factionId: 556 }), false)
    assert.equal(isLevellingEditor({ id: 7, factionId: null }), false)
    // Player and faction IDs are separate lists and must not match each other.
    assert.equal(isLevellingEditor({ id: 555, factionId: 42 }), false)
  })
})

test('empty or malformed editor configuration makes nobody an editor', () => {
  const configurations: [string | undefined, string | undefined][] = [
    [undefined, undefined],
    ['', ''],
    [' , ', ' '],
    ['abc,-1,0,1.5', 'NaN, ,0'],
  ]
  for (const [ids, factions] of configurations) {
    withEditorEnv({ ids, factions }, () => {
      // Blank entries parse as 0, which must never match a missing ID.
      assert.equal(isLevellingEditor({ id: 0, factionId: 0 }), false)
      assert.equal(isLevellingEditor({ id: 1, factionId: 1 }), false)
      assert.equal(isLevellingEditor({ id: 42, factionId: null }), false)
    })
  }
})

test('changing the list requires a verified Torn key and shared storage', async () => {
  await withListEnvironment(async ({ changes, request }) => {
    const remove = { playerId: bundledPlayers[0].id, action: 'remove' }
    const missing = await request('', 'POST', remove)
    assert.equal(missing.status, 401)
    assert.match((await missing.json()).error, /API key/)
    // A key Torn rejects must not count as an editor or an anonymous change.
    const rejected = await request('rejected-key', 'POST', remove)
    assert.equal(rejected.status, 401)
    assert.equal((await rejected.json()).error, 'Incorrect key')
    delete process.env.DATABASE_URL
    const withoutStorage = await request('editor-key', 'POST', remove)
    assert.equal(withoutStorage.status, 503)
    assert.equal(changes.length, 0)
  })
})

test('an untrusted user cannot remove players from the shared list', async () => {
  await withListEnvironment(async ({ changes, request }) => {
    for (const player of bundledPlayers.slice(0, 3)) {
      const response = await request('stranger-key', 'POST', {
        playerId: player.id,
        action: 'remove',
      })
      assert.equal(response.status, 403)
      assert.match((await response.json()).error, /trusted editors/)
    }
    assert.equal(changes.length, 0)
    const list = await (await request('stranger-key', 'GET')).json()
    assert.equal(list.players.length, bundledPlayers.length)
    assert.equal(list.canEdit, false)
  })
})

test('nobody can remove players when no editors are configured', async () => {
  await withListEnvironment(async ({ changes, request }) => {
    for (const value of [undefined, '', ' , ']) {
      setEnv('LEVELLING_EDITOR_IDS', value)
      setEnv('LEVELLING_EDITOR_FACTION_IDS', value)
      for (const key of ['editor-key', 'faction-key']) {
        const response = await request(key, 'POST', {
          playerId: bundledPlayers[0].id,
          action: 'remove',
        })
        assert.equal(response.status, 403)
        assert.equal((await (await request(key, 'GET')).json()).canEdit, false)
      }
    }
    assert.equal(changes.length, 0)
  })
})

test('trusted editors by player or faction ID can remove players', async () => {
  await withListEnvironment(async ({ changes, request }) => {
    const [first, second] = bundledPlayers
    const byId = await request('editor-key', 'POST', {
      playerId: first.id,
      action: 'remove',
    })
    assert.equal(byId.status, 200)
    const payload = await byId.json()
    assert.equal(payload.canEdit, true)
    assert.ok(
      !payload.players.some((player: { id: number }) => player.id === first.id),
    )
    const byFaction = await request('faction-key', 'POST', {
      playerId: second.id,
      action: 'remove',
    })
    assert.equal(byFaction.status, 200)
    assert.deepEqual(
      changes.map((change) => [change.playerId, change.changedById]),
      [
        [first.id, 42],
        [second.id, 77],
      ],
    )
    const again = await request('editor-key', 'POST', {
      playerId: first.id,
      action: 'remove',
    })
    assert.equal(again.status, 404)
  })
})

test('anyone can add new players, but only editors can restore removed ones', async () => {
  await withListEnvironment(async ({ changes, request }) => {
    const added = await request('stranger-key', 'POST', {
      playerId: NEW_PLAYER,
      action: 'add',
      name: 'Spoofed',
      addedById: 1,
    })
    assert.equal(added.status, 200)
    const addedPlayer = (await added.json()).players.find(
      (player: { id: number }) => player.id === NEW_PLAYER,
    )
    // Identity and player data come from Torn, never from the request body.
    assert.deepEqual(
      [
        addedPlayer.name,
        addedPlayer.level,
        addedPlayer.total,
        addedPlayer.addedBy,
      ],
      [`Player ${NEW_PLAYER}`, 18, 250, { id: 66, name: 'Stranger' }],
    )
    const duplicate = await request('stranger-key', 'POST', {
      playerId: NEW_PLAYER,
      action: 'add',
    })
    assert.equal(duplicate.status, 409)

    const removed = bundledPlayers[0]
    await request('editor-key', 'POST', {
      playerId: removed.id,
      action: 'remove',
    })
    const restoreByStranger = await request('stranger-key', 'POST', {
      playerId: removed.id,
      action: 'add',
    })
    assert.equal(restoreByStranger.status, 403)
    assert.equal(
      changes.find((change) => change.playerId === removed.id)?.removed,
      true,
    )
    const restoreByEditor = await request('editor-key', 'POST', {
      playerId: removed.id,
      action: 'add',
    })
    assert.equal(restoreByEditor.status, 200)
    assert.ok(
      (await restoreByEditor.json()).players.some(
        (player: { id: number }) => player.id === removed.id,
      ),
    )
  })
})

test('the list stays public and reports editor access only for editors', async () => {
  await withListEnvironment(async ({ request }) => {
    const anonymous = await (await request('', 'GET')).json()
    assert.equal(anonymous.players.length, bundledPlayers.length)
    assert.equal(anonymous.canEdit, false)
    for (const [key, canEdit] of [
      ['editor-key', true],
      ['faction-key', true],
      ['stranger-key', false],
    ] as const) {
      assert.equal((await (await request(key, 'GET')).json()).canEdit, canEdit)
    }
    // A broken key must not hide the list, only editor access.
    const broken = await request('broken-key', 'GET')
    assert.equal(broken.status, 200)
    assert.equal((await broken.json()).canEdit, false)
  })
})

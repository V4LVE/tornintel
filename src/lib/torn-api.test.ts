import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createTornClient } from './torn-api.server'

function url(key = 'one', selection = 'profile') {
  const result = new URL('https://api.torn.com/user/')
  result.searchParams.set('key', key)
  result.searchParams.set('selections', selection)
  return result
}

test('coalesces concurrent requests, preserves timestamps, and isolates cached data', async () => {
  const originalFetch = globalThis.fetch
  const client = createTornClient()
  let calls = 0
  globalThis.fetch = async () => {
    calls++
    return Response.json({ name: 'Player' })
  }
  try {
    const [first, second] = await Promise.all([
      client<{ name: string }>(url(), { maxAgeMs: 1000 }),
      client<{ name: string }>(url(), { maxAgeMs: 1000 }),
    ])
    assert.equal(calls, 1)
    assert.equal(first.fetchedAt, second.fetchedAt)
    first.data.name = 'Changed'
    assert.equal(second.data.name, 'Player')
    const cached = await client<{ name: string }>(url(), { maxAgeMs: 1000 })
    assert.equal(cached.data.name, 'Player')
    assert.equal(cached.fetchedAt, second.fetchedAt)
    assert.equal(calls, 1)
    await client(url('two'), { maxAgeMs: 1000 })
    await client(url('one', 'attacks'), { maxAgeMs: 1000 })
    assert.equal(calls, 3)
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('expires cached results and honors stricter freshness requirements', async (context) => {
  context.mock.timers.enable({ apis: ['Date'], now: 1000 })
  const originalFetch = globalThis.fetch
  const client = createTornClient()
  let calls = 0
  globalThis.fetch = async () => Response.json({ calls: ++calls })
  try {
    await client(url(), { maxAgeMs: 1000 })
    context.mock.timers.tick(500)
    await client(url(), { maxAgeMs: 1000 })
    assert.equal(calls, 1)
    await client(url(), { maxAgeMs: 100 })
    assert.equal(calls, 2)
    context.mock.timers.tick(100)
    await client(url(), { maxAgeMs: 100 })
    assert.equal(calls, 3)
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('does not cache Torn errors or network failures', async () => {
  const originalFetch = globalThis.fetch
  const client = createTornClient()
  let calls = 0
  globalThis.fetch = async () => {
    calls++
    if (calls === 1)
      return Response.json({ error: { code: 5, error: 'Too many requests' } })
    if (calls === 2) throw new Error('Offline')
    return Response.json({ ok: true })
  }
  try {
    await assert.rejects(client(url(), { maxAgeMs: 1000 }), /Too many requests/)
    await assert.rejects(client(url(), { maxAgeMs: 1000 }), /Offline/)
    await client(url(), { maxAgeMs: 1000 })
    assert.equal(calls, 3)
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('cache eligibility keeps available target status fresh', async () => {
  const originalFetch = globalThis.fetch
  const client = createTornClient()
  let calls = 0
  globalThis.fetch = async () => Response.json({ available: ++calls <= 2 })
  const options = {
    maxAgeMs: 1000,
    cacheWhen: (data: unknown) => !(data as { available: boolean }).available,
  }
  try {
    await client(url(), options)
    await client(url(), options)
    await client(url(), options)
    await client(url(), options)
    assert.equal(calls, 3)
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('bounds cache growth by evicting completed entries', async () => {
  const originalFetch = globalThis.fetch
  const client = createTornClient(2)
  let calls = 0
  globalThis.fetch = async () => Response.json({ calls: ++calls })
  try {
    for (const key of ['one', 'two', 'three', 'two', 'one']) {
      await client(url(key), { maxAgeMs: 1000 })
    }
    assert.equal(calls, 4)
  } finally {
    globalThis.fetch = originalFetch
  }
})

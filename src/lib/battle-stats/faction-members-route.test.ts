import assert from 'node:assert/strict'
import { test } from 'node:test'
import { Route } from '../../routes/api/faction-members'

const handlers = Route.options.server?.handlers
if (!handlers || typeof handlers === 'function') {
  throw new Error('Expected object-based faction members route handlers')
}
const handler = handlers.GET

async function invokeRoute() {
  if (!handler) throw new Error('Missing GET handler')
  const response = await handler({
    request: new Request('http://localhost/api/faction-members?factionId=123', {
      headers: { 'x-torn-api-key': 'test-key' },
    }),
  } as never)
  if (!(response instanceof Response)) throw new Error('Expected a response')
  return response
}

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

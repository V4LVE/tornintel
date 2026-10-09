import assert from 'node:assert/strict'
import { test } from 'node:test'
import { estimateTravel, observeTravel, parseTravelRoute } from './travel'
import { syncTravelTracking, travelTrackingRepository } from './travel.server'

const now = 1791532800000
const outbound = {
  state: 'Traveling',
  description: 'Traveling from Torn to Mexico',
  until: null,
}

test('parses outbound and returning routes without treating abroad as a flight', () => {
  assert.deepEqual(parseTravelRoute(outbound.description), {
    country: 'Mexico',
    direction: 'OUTBOUND',
  })
  for (const description of [
    'Returning from Mexico',
    'Returning to Torn from Mexico',
    'Traveling from Mexico to Torn',
  ]) {
    assert.deepEqual(parseTravelRoute(description), {
      country: 'Mexico',
      direction: 'RETURNING',
    })
  }
  assert.deepEqual(parseTravelRoute('Traveling to UAE'), {
    country: 'United Arab Emirates',
    direction: 'OUTBOUND',
  })
  assert.deepEqual(parseTravelRoute('Traveling to Torn'), {
    country: null,
    direction: 'RETURNING',
  })
  assert.equal(
    estimateTravel(
      { state: 'Abroad', description: 'In Mexico' },
      observeTravel({ state: 'Abroad' }, now),
    ),
    null,
  )
})

test('first seen mid-flight has unknown departure and a pinned upper estimate', () => {
  const first = observeTravel(outbound, now)
  const later = observeTravel(outbound, now + 30000, first)
  const estimate = estimateTravel(outbound, later)!
  assert.equal(estimate.departureObserved, false)
  assert.equal(estimate.earliestArrivalAt, now)
  assert.equal(estimate.latestArrivalAt, now + 24 * 1.03 * 60000)
  assert.equal(later.firstSeenAt, now)
})

test('observed departure bounds include polling uncertainty, fast flights, books, and variance', () => {
  const before = observeTravel({ state: 'Okay' }, now)
  const flight = observeTravel(outbound, now + 30000, before)
  const estimate = estimateTravel(outbound, flight)!
  assert.equal(estimate.departureObserved, true)
  assert.equal(estimate.earliestArrivalAt, now + 5 * 0.97 * 60000)
  assert.equal(estimate.latestArrivalAt, now + 30000 + 24 * 1.03 * 60000)
})

test('a return leg starts a new tracking window and landing clears the flight', () => {
  const outboundSnapshot = observeTravel(outbound, now)
  const returning = { state: 'Traveling', description: 'Returning from Mexico' }
  const returnSnapshot = observeTravel(returning, now + 30000, outboundSnapshot)
  assert.equal(returnSnapshot.firstSeenAt, now + 30000)
  assert.equal(
    estimateTravel(returning, returnSnapshot)?.direction,
    'RETURNING',
  )
  const landed = observeTravel({ state: 'Okay' }, now + 60000, returnSnapshot)
  assert.equal(landed.firstSeenAt, null)
  assert.equal(estimateTravel({ state: 'Okay' }, landed), null)
})

test('cached or out-of-order observations cannot move departure or overwrite newer status', () => {
  const flight = observeTravel(outbound, now)
  const landed = observeTravel({ state: 'Okay' }, now + 30000, flight)
  assert.deepEqual(observeTravel(outbound, now, landed), landed)
  assert.deepEqual(observeTravel(outbound, now, flight), flight)
})

test('monitoring gaps lose departure certainty rather than reuse an earlier trip', () => {
  const before = observeTravel({ state: 'Okay' }, now)
  const flight = observeTravel(outbound, now + 30000, before)
  const afterGap = observeTravel(outbound, now + 3600000, flight)
  assert.equal(afterGap.departureEarliestAt, null)
  assert.equal(afterGap.firstSeenAt, now + 3600000)
  const firstAfterGap = observeTravel(outbound, now + 3600000, before)
  assert.equal(firstAfterGap.departureEarliestAt, null)
})

test('unknown or hidden routes stay unknown; hospital timers do not become landing times', () => {
  const hidden = { state: 'Traveling', description: 'Traveling' }
  assert.equal(
    estimateTravel(hidden, observeTravel(hidden, now))?.timing,
    'UNKNOWN',
  )
  assert.equal(
    estimateTravel(
      { state: 'Hospital', until: now / 1000 + 600 },
      observeTravel({ state: 'Hospital' }, now),
    ),
    null,
  )
})

test('uses a reported future arrival when present and never extends an overdue flight on sync', () => {
  const reported = { ...outbound, until: now / 1000 + 600 }
  const snapshot = observeTravel(reported, now)
  assert.equal(estimateTravel(reported, snapshot)?.timing, 'REPORTED')
  assert.equal(
    estimateTravel(reported, snapshot)?.latestArrivalAt,
    now + 600000,
  )
  let tracked = snapshot
  for (let time = now + 60000; time <= now + 1800000; time += 60000)
    tracked = observeTravel(outbound, time, tracked)
  assert.equal(
    estimateTravel(outbound, tracked)?.latestArrivalAt,
    now + 24 * 1.03 * 60000,
  )
})

test('temporary storage fallback preserves a departure captured before a database outage', async (context) => {
  const previous = process.env.DATABASE_URL
  process.env.DATABASE_URL = 'postgresql://test'
  const playerId = 'travel-fallback-test'
  let saved = observeTravel({ state: 'Okay' }, now)
  let offline = false
  context.mock.method(travelTrackingRepository, 'sync', async () => {
    if (offline) throw new Error('offline')
    return new Map([[playerId, saved]])
  })
  try {
    await syncTravelTracking([{ playerId, status: { state: 'Okay' } }], now)
    saved = observeTravel(outbound, now + 30000, saved)
    const persisted = await syncTravelTracking(
      [{ playerId, status: outbound }],
      now + 30000,
    )
    offline = true
    const fallback = await syncTravelTracking(
      [{ playerId, status: outbound }],
      now + 60000,
    )
    assert.deepEqual(
      fallback.travel.get(playerId),
      persisted.travel.get(playerId),
    )
    assert.match(fallback.reason ?? '', /temporarily stored/)
  } finally {
    if (previous === undefined) delete process.env.DATABASE_URL
    else process.env.DATABASE_URL = previous
  }
})

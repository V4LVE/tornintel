import assert from 'node:assert/strict'
import test from 'node:test'
import { calculatePayouts } from './payouts'

const players = [
  { id: '42', name: 'War player', warHits: 10, nonWarHits: 2 },
  { id: '99', name: 'Chain player', warHits: 0, nonWarHits: 3 },
]

test('outside hits use a separate fixed rate and the checkbox excludes their payments', () => {
  const included = calculatePayouts(players, 10000000, 500000, 100000, true)
  assert.deepEqual(
    included.payouts.map((player) => player.amount),
    [5200000, 300000],
  )
  assert.equal(included.outsideHits, 5)
  assert.equal(included.total, 5500000)
  assert.equal(included.remainder, 4500000)
  const excluded = calculatePayouts(players, 10000000, 500000, 100000, false)
  assert.deepEqual(
    excluded.payouts.map((player) => player.amount),
    [5000000, 0],
  )
  assert.equal(excluded.outsideHits, 0)
  assert.equal(excluded.total, 5000000)
  assert.equal(excluded.remainder, 5000000)
})

test('outside payments stay fixed while war payments use the remaining budget', () => {
  const result = calculatePayouts(players, 4000000, 500000, 100000, true)
  assert.equal(result.appliedOutsideRate, 100000)
  assert.equal(result.appliedWarRate, 350000)
  assert.equal(result.total, 4000000)
  assert.equal(result.capped, true)
})

test('outside payments are capped when they alone exceed the earnings', () => {
  const result = calculatePayouts(players, 300000, 500000, 100000, true)
  assert.equal(result.appliedOutsideRate, 60000)
  assert.equal(result.appliedWarRate, 0)
  assert.equal(result.total, 300000)
  assert.equal(result.remainder, 0)
})

test('payouts round down to whole dollars and handle zero and invalid inputs', () => {
  const result = calculatePayouts(players, 101, 500, 1, true)
  assert.deepEqual(
    result.payouts.map((player) => player.amount),
    [98, 3],
  )
  assert.equal(result.total, 101)
  assert.equal(calculatePayouts([], 100, 10, 5, true).total, 0)
  assert.equal(calculatePayouts(players, 0, 500, 100, true).total, 0)
  assert.equal(calculatePayouts(players, -10, 500, 100, true).total, 0)
  assert.equal(calculatePayouts(players, 100, NaN, Infinity, true).total, 0)
})

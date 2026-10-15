import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  matchesQuery,
  nextSort,
  pageRange,
  paginate,
  sortItems,
} from './table-view'

test('matches every search word against any field, ignoring case', () => {
  assert.equal(matchesQuery(['Duke', 4], ''), true)
  assert.equal(matchesQuery(['Duke', 4], '  '), true)
  assert.equal(matchesQuery(['Duke', 4], 'duk'), true)
  assert.equal(matchesQuery(['Duke', 4], 'duke 4'), true)
  assert.equal(matchesQuery(['Duke', 4], 'duke 5'), false)
  assert.equal(matchesQuery(['Duke', null, undefined], 'null'), false)
})

test('sorts both ways and keeps missing values last', () => {
  const items = [
    { name: 'b', value: 2 },
    { name: 'none', value: null },
    { name: 'a', value: 1 },
    { name: 'inf', value: Infinity },
    { name: 'c', value: 3 },
  ]
  const ascending = sortItems(items, (item) => item.value, 'asc')
  assert.deepEqual(
    ascending.map((item) => item.name),
    ['a', 'b', 'c', 'none', 'inf'],
  )
  const descending = sortItems(items, (item) => item.value, 'desc')
  assert.deepEqual(
    descending.map((item) => item.name),
    ['c', 'b', 'a', 'none', 'inf'],
  )
  assert.deepEqual(
    items.map((item) => item.name),
    ['b', 'none', 'a', 'inf', 'c'],
    'the input is not mutated',
  )
})

test('sorts strings naturally and keeps ties in their original order', () => {
  const names = ['item10', 'Item2', 'item1', 'item2']
  assert.deepEqual(
    sortItems(names, (name) => name, 'asc'),
    ['item1', 'Item2', 'item2', 'item10'],
  )
})

test('cycles a column through ascending, descending and default', () => {
  const ascending = nextSort(null, 'level')
  assert.deepEqual(ascending, { key: 'level', direction: 'asc' })
  const descending = nextSort(ascending, 'level')
  assert.deepEqual(descending, { key: 'level', direction: 'desc' })
  assert.equal(nextSort(descending, 'level'), null)
  assert.deepEqual(nextSort(descending, 'name'), {
    key: 'name',
    direction: 'asc',
  })
})

test('paginates and clamps the page to the available range', () => {
  const items = Array.from({ length: 23 }, (_, index) => index + 1)
  const second = paginate(items, 2, 10)
  assert.deepEqual(second.items, [11, 12, 13, 14, 15, 16, 17, 18, 19, 20])
  assert.equal(second.pageCount, 3)
  assert.equal(second.first, 11)
  assert.equal(second.last, 20)

  const beyond = paginate(items, 9, 10)
  assert.equal(beyond.page, 3)
  assert.deepEqual(beyond.items, [21, 22, 23])

  const empty = paginate([], 4, 10)
  assert.equal(empty.page, 1)
  assert.equal(empty.pageCount, 1)
  assert.equal(empty.first, 0)
  assert.equal(empty.last, 0)
})

test('shows the first, last and nearby pages with gaps between them', () => {
  assert.deepEqual(pageRange(1, 1), [1])
  assert.deepEqual(pageRange(1, 5), [1, 2, 'gap', 5])
  assert.deepEqual(pageRange(3, 5), [1, 2, 3, 4, 5])
  assert.deepEqual(pageRange(10, 20), [1, 'gap', 9, 10, 11, 'gap', 20])
  assert.deepEqual(pageRange(4, 20), [1, 2, 3, 4, 5, 'gap', 20])
  assert.deepEqual(pageRange(20, 20), [1, 'gap', 19, 20])
})

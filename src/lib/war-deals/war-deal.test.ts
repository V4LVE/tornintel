import assert from 'node:assert/strict'
import test from 'node:test'
import { generateDealMessage, summarizeDeal } from './war-deal'

const options = {
  ourName: 'NPC',
  theirName: 'Other faction',
  winningScore: 8500,
  losingScore: 3000,
  weWin: true,
  rate: 1000,
  itemName: 'Xanax',
  itemValue: 800000,
  paymentTiming: 'Within 24 hours',
  offlineMinutes: 15,
  extraTerms: '',
}

test('keeps faction cache values separate and computes combined score and net lead', () => {
  assert.deepEqual(
    summarizeDeal(8500, 3000, [
      { name: 'Armor', ours: 2, theirs: 1, price: 100000000 },
      { name: 'Melee', ours: 1, theirs: 2, price: 50000000 },
    ]),
    {
      totalScore: 11500,
      lead: 5500,
      ourCaches: 3,
      theirCaches: 3,
      ourValue: 250000000,
      theirValue: 200000000,
    },
  )
})

test('both outcomes pay the loser on losing score, with whole items and a cash remainder', () => {
  const winning = generateDealMessage(options)
  assert.match(winning, /NPC: 8,500\nOther faction: 3,000\nNPC takes the win/)
  assert.match(winning, /Other faction receives 3 Xanax plus \$600,000 cash/)
  const losing = generateDealMessage({ ...options, weWin: false })
  assert.match(
    losing,
    /NPC: 3,000\nOther faction: 8,500\nOther faction takes the win/,
  )
  assert.match(losing, /NPC receives 3 Xanax plus \$600,000 cash/)
  assert.match(losing, /planned compensation is \$3,000,000/)
})

test('a provided rate without an item price quotes the value and requests item agreement', () => {
  const message = generateDealMessage({
    ...options,
    itemValue: 0,
    extraTerms: 'Contact Alex for med-out partners.',
  })
  assert.match(message, /Item type and valuation to be agreed/)
  assert.doesNotMatch(message, /NaN|Infinity|receives 0 Xanax/)
  assert.match(message, /Contact Alex for med-out partners/)
})

test('fixed cash pays the loser the same amount for either outcome and any score', () => {
  for (const weWin of [true, false]) {
    for (const losingScore of [1000, 3000]) {
      const message = generateDealMessage({
        ...options,
        weWin,
        losingScore,
        fixedCash: 25000000,
      })
      const recipient = weWin ? 'Other faction' : 'NPC'
      assert.ok(
        message.includes(
          `${recipient} receives a fixed cash compensation of $25,000,000, regardless of the final war score.`,
        ),
      )
      assert.match(message, /Payment: Within 24 hours\./)
      assert.doesNotMatch(
        message,
        /per war score point|Xanax|valuation|rounding|report to confirm the score/,
      )
    }
  }
})

test('blank fixed cash omits compensation even when a previous rate is set', () => {
  const message = generateDealMessage({
    ...options,
    fixedCash: 0,
    paymentTiming: '',
  })
  assert.doesNotMatch(message, /Payment:|compensation|receives|Xanax/)
})

test('fixed cash compensation can be supplied without payment timing', () => {
  const message = generateDealMessage({
    ...options,
    fixedCash: 25000000,
    rate: 0,
    paymentTiming: '',
  })
  assert.match(message, /fixed cash compensation of \$25,000,000/)
  assert.doesNotMatch(message, /Payment:/)
})

test('blank payment fields omit all payment wording even with fetched item prices', () => {
  for (const weWin of [true, false]) {
    const message = generateDealMessage({
      ...options,
      weWin,
      rate: 0,
      paymentTiming: '  ',
    })
    assert.doesNotMatch(
      message,
      /Payment:|compensation|receives|valuation|Xanax|24 hours/,
    )
    assert.match(message, /confirm the scores, med-out partners, and terms/)
  }
})

test('payment timing and compensation appear independently only when supplied', () => {
  const rateOnly = generateDealMessage({ ...options, paymentTiming: '' })
  assert.match(rateOnly, /receives 3 Xanax/)
  assert.doesNotMatch(rateOnly, /Payment:|24 hours/)
  const timingOnly = generateDealMessage({ ...options, rate: 0 })
  assert.match(timingOnly, /Payment: Within 24 hours/)
  assert.doesNotMatch(timingOnly, /receives|Xanax|valuation/)
})

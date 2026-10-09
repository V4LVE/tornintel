import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  sharedEvidenceRepository,
  syncSharedEvidence,
} from './shared-evidence.server'
import type { SharedObservation } from './shared-evidence.server'

const evidence: SharedObservation = {
  evidenceId: '789:42',
  playerId: '456',
  sourcePlayerId: '789',
  observation: {
    targetId: '456',
    attackerId: '789',
    attackerBss: 4000,
    fairFight: 2,
    timestamp: 1700000000000,
  },
}

test('continues reading stored evidence when saving fails', async (context) => {
  const previous = process.env.DATABASE_URL
  process.env.DATABASE_URL = 'postgresql://test'
  context.mock.method(sharedEvidenceRepository, 'save', async () => {
    throw new Error('offline')
  })
  context.mock.method(sharedEvidenceRepository, 'load', async () => [evidence])
  try {
    const result = await syncSharedEvidence([], ['456'])
    assert.equal(result.status, 'UNAVAILABLE')
    assert.match(result.reason ?? '', /could not be saved/)
    assert.deepEqual(result.observations.get('456'), [evidence.observation])
  } finally {
    if (previous === undefined) delete process.env.DATABASE_URL
    else process.env.DATABASE_URL = previous
  }
})

test('keeps personal evidence and reports a warning when storage cannot be read', async (context) => {
  const previous = process.env.DATABASE_URL
  process.env.DATABASE_URL = 'postgresql://test'
  context.mock.method(sharedEvidenceRepository, 'save', async () => {})
  context.mock.method(sharedEvidenceRepository, 'load', async () => {
    throw new Error('offline')
  })
  try {
    const result = await syncSharedEvidence([evidence], ['456'])
    assert.equal(result.status, 'UNAVAILABLE')
    assert.deepEqual(result.observations.get('456'), [evidence.observation])
    assert.match(result.reason ?? '', /could not be loaded/)
  } finally {
    if (previous === undefined) delete process.env.DATABASE_URL
    else process.env.DATABASE_URL = previous
  }
})

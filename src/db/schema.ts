import {
  integer,
  index,
  jsonb,
  pgTable,
  real,
  serial,
  text,
  timestamp,
} from 'drizzle-orm/pg-core'
import type { FairFightObservation } from '../lib/battle-stats/estimator'
import type { TravelSnapshot } from '../lib/travel'

export const factionMemberTravel = pgTable('faction_member_travel', {
  playerId: text('player_id').primaryKey(),
  snapshot: jsonb().$type<TravelSnapshot>().notNull(),
})

export const sharedFairFightObservations = pgTable(
  'shared_fair_fight_observations',
  {
    evidenceId: text('evidence_id').primaryKey(),
    playerId: text('player_id').notNull(),
    sourcePlayerId: text('source_player_id').notNull(),
    sourcePlayerName: text('source_player_name'),
    observation: jsonb().$type<FairFightObservation>().notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [index('shared_ff_player_idx').on(table.playerId)],
)

export const todos = pgTable('todos', {
  id: serial().primaryKey(),
  title: text().notNull(),
  createdAt: timestamp('created_at').defaultNow(),
})

// Persist raw evidence so estimates can be recalculated as the model improves.
export const battleStatEvidence = pgTable('battle_stat_evidence', {
  id: serial().primaryKey(),
  playerId: text('player_id').notNull(),
  type: text().notNull(),
  value: real().notNull(),
  sourcePlayerId: text('source_player_id'),
  attackId: text('attack_id'),
  fairFight: real('fair_fight'),
  calculatedBss: real('calculated_bss'),
  observedAt: timestamp('observed_at').notNull(),
  quality: real().notNull(),
  metadata: jsonb(),
  createdAt: timestamp('created_at').defaultNow(),
})

export const battleStatCalibrationSamples = pgTable(
  'battle_stat_calibration_samples',
  {
    id: serial().primaryKey(),
    playerId: text('player_id').notNull(),
    strength: real().notNull(),
    speed: real().notNull(),
    defense: real().notNull(),
    dexterity: real().notNull(),
    totalStats: real('total_stats').notNull(),
    bss: real().notNull(),
    balanceFactor: real('balance_factor').notNull(),
    observedAt: timestamp('observed_at').notNull(),
    source: text().notNull(),
    sampleSize: integer('sample_size').default(1),
  },
)

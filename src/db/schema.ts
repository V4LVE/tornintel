import {
  boolean,
  doublePrecision,
  integer,
  index,
  jsonb,
  pgTable,
  primaryKey,
  real,
  serial,
  text,
  timestamp,
} from 'drizzle-orm/pg-core'
import type { FairFightObservation } from '#/models/battle-stats'
import type { TravelSnapshot } from '#/models/travel'

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

// Players who opted in to show their real battle stats to their faction.
// The faction is re-read from Torn whenever the player's stats are recorded.
export const statSharing = pgTable(
  'stat_sharing',
  {
    playerId: text('player_id').primaryKey(),
    playerName: text('player_name').notNull(),
    factionId: text('faction_id').notNull(),
    // Sharing is on by default; an opt-out keeps the row with false so the
    // choice is remembered.
    enabled: boolean('enabled').notNull().default(true),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => [index('stat_sharing_faction_idx').on(table.factionId)],
)

// Server-fetched battle stat readings for sharing players, one per UTC day.
// `timestamp` is the end of the day; `observedAt` is when Torn observed the
// values, so an older reading never replaces a newer one in the same day.
export const sharedStatSnapshots = pgTable(
  'shared_stat_snapshots',
  {
    playerId: text('player_id').notNull(),
    timestamp: integer().notNull(),
    observedAt: integer('observed_at').notNull().default(0),
    strength: doublePrecision().notNull(),
    defense: doublePrecision().notNull(),
    speed: doublePrecision().notNull(),
    dexterity: doublePrecision().notNull(),
    total: doublePrecision().notNull(),
  },
  (table) => [primaryKey({ columns: [table.playerId, table.timestamp] })],
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

// Shared changes to the bundled levelling lists: players added from FF Scouter
// discovery, and players removed because they are no longer useful targets.
export const levellingListChanges = pgTable('levelling_list_changes', {
  playerId: integer('player_id').primaryKey(),
  name: text().notNull(),
  level: integer().notNull(),
  totalEstimate: real('total_estimate'),
  removed: boolean().notNull().default(false),
  addedById: integer('added_by_id'),
  addedByName: text('added_by_name'),
  changedById: integer('changed_by_id').notNull(),
  changedAt: timestamp('changed_at').defaultNow().notNull(),
})

CREATE TABLE IF NOT EXISTS "battle_stat_calibration_samples" (
	"id" serial PRIMARY KEY NOT NULL,
	"player_id" text NOT NULL,
	"strength" real NOT NULL,
	"speed" real NOT NULL,
	"defense" real NOT NULL,
	"dexterity" real NOT NULL,
	"total_stats" real NOT NULL,
	"bss" real NOT NULL,
	"balance_factor" real NOT NULL,
	"observed_at" timestamp NOT NULL,
	"source" text NOT NULL,
	"sample_size" integer DEFAULT 1
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "battle_stat_evidence" (
	"id" serial PRIMARY KEY NOT NULL,
	"player_id" text NOT NULL,
	"type" text NOT NULL,
	"value" real NOT NULL,
	"source_player_id" text,
	"attack_id" text,
	"fair_fight" real,
	"calculated_bss" real,
	"observed_at" timestamp NOT NULL,
	"quality" real NOT NULL,
	"metadata" jsonb,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "shared_fair_fight_observations" (
	"evidence_id" text PRIMARY KEY NOT NULL,
	"player_id" text NOT NULL,
	"source_player_id" text NOT NULL,
	"observation" jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "todos" (
	"id" serial PRIMARY KEY NOT NULL,
	"title" text NOT NULL,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "shared_ff_player_idx" ON "shared_fair_fight_observations" USING btree ("player_id");

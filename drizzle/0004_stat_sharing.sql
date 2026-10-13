CREATE TABLE "shared_stat_snapshots" (
	"player_id" text NOT NULL,
	"timestamp" integer NOT NULL,
	"strength" double precision NOT NULL,
	"defense" double precision NOT NULL,
	"speed" double precision NOT NULL,
	"dexterity" double precision NOT NULL,
	"total" double precision NOT NULL,
	CONSTRAINT "shared_stat_snapshots_player_id_timestamp_pk" PRIMARY KEY("player_id","timestamp")
);
--> statement-breakpoint
CREATE TABLE "stat_sharing" (
	"player_id" text PRIMARY KEY NOT NULL,
	"player_name" text NOT NULL,
	"faction_id" text NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "stat_sharing_faction_idx" ON "stat_sharing" USING btree ("faction_id");
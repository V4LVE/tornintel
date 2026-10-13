CREATE TABLE "levelling_list_changes" (
	"player_id" integer PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"level" integer NOT NULL,
	"total_estimate" real,
	"removed" boolean DEFAULT false NOT NULL,
	"added_by_id" integer,
	"added_by_name" text,
	"changed_by_id" integer NOT NULL,
	"changed_at" timestamp DEFAULT now() NOT NULL
);

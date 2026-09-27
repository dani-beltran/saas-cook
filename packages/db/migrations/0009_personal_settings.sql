CREATE TABLE "identity"."user_avatar" (
	"user_id" text PRIMARY KEY NOT NULL,
	"version" uuid NOT NULL,
	"bytes" "bytea",
	CONSTRAINT "user_avatar_version_unique" UNIQUE("version"),
	CONSTRAINT "user_avatar_bytes_check" CHECK (octet_length("identity"."user_avatar"."bytes") BETWEEN 1 AND 524288)
);
--> statement-breakpoint
ALTER TABLE "identity"."user" ADD COLUMN "theme_mode" text;--> statement-breakpoint
ALTER TABLE "identity"."user" ADD COLUMN "theme_version" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "identity"."user_avatar" ADD CONSTRAINT "user_avatar_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "identity"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "identity"."user" ADD CONSTRAINT "user_theme_mode_check" CHECK ("identity"."user"."theme_mode" IS NULL OR "identity"."user"."theme_mode" IN ('light','dark','system'));--> statement-breakpoint
ALTER TABLE "identity"."user" ADD CONSTRAINT "user_theme_version_check" CHECK ("identity"."user"."theme_version">=0);
--> statement-breakpoint
-- Personal identity storage is deliberately unavailable to tenant web/worker roles.
GRANT SELECT, INSERT, UPDATE, DELETE ON identity.user_avatar TO saas_cook_identity;

CREATE TABLE "foundation"."runtime_probes" (
	"id" uuid PRIMARY KEY NOT NULL,
	"processed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
GRANT SELECT ON foundation.runtime_probes TO saas_cook_web, saas_cook_worker;
GRANT INSERT ON foundation.runtime_probes TO saas_cook_worker;

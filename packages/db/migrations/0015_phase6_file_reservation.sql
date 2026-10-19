ALTER TABLE "tenancy"."capacity_reservations" ADD CONSTRAINT "capacity_reservations_org_id" UNIQUE("organization_id","id");
--> statement-breakpoint
ALTER TABLE "tenancy"."files" ADD CONSTRAINT "files_organization_id_reservation_id_capacity_reservations_organization_id_id_fk" FOREIGN KEY ("organization_id","reservation_id") REFERENCES "tenancy"."capacity_reservations"("organization_id","id") ON DELETE no action ON UPDATE no action;

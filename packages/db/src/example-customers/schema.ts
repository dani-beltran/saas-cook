import { sql } from "drizzle-orm";
import {
	check,
	foreignKey,
	index,
	integer,
	pgPolicy,
	primaryKey,
	text,
	timestamp,
	unique,
	uuid,
} from "drizzle-orm/pg-core";
import { organizations, tenancy } from "../tenancy-schema";

const policies = () => [
	pgPolicy("migration_control", {
		for: "all",
		to: ["saas_cook_migrator"],
		using: sql`true`,
		withCheck: sql`true`,
	}),
	pgPolicy("tenant_isolation", {
		for: "all",
		to: ["public"],
		using: sql`organization_id = nullif(current_setting('app.organization_id',true),'')::uuid`,
		withCheck: sql`organization_id = nullif(current_setting('app.organization_id',true),'')::uuid`,
	}),
];
export const exampleCustomers = tenancy
	.table(
		"example_customers",
		{
			id: uuid().primaryKey(),
			organizationId: uuid("organization_id")
				.notNull()
				.references(() => organizations.id),
			name: text().notNull(),
			email: text().notNull(),
			company: text(),
			status: text().notNull().default("lead"),
			version: integer().notNull().default(1),
			createdAt: timestamp("created_at", { withTimezone: true, precision: 3 })
				.notNull()
				.defaultNow(),
			updatedAt: timestamp("updated_at", { withTimezone: true, precision: 3 })
				.notNull()
				.defaultNow(),
			deletedAt: timestamp("deleted_at", { withTimezone: true, precision: 3 }),
		},
		(t) => [
			unique("example_customers_org_id").on(t.organizationId, t.id),
			index("example_customers_search_name")
				.using("gin", sql`to_tsvector('simple',name)`)
				.where(sql`deleted_at IS NULL`),
			check(
				"example_customers_name",
				sql`length(btrim(name)) BETWEEN 1 AND 120`,
			),
			check(
				"example_customers_email",
				sql`length(email) BETWEEN 3 AND 254 AND email LIKE '%@%'`,
			),
			check(
				"example_customers_company",
				sql`company IS NULL OR length(btrim(company)) BETWEEN 1 AND 120`,
			),
			check(
				"example_customers_status",
				sql`status IN ('lead','active','inactive')`,
			),
			check("example_customers_version", sql`version > 0`),
			index("example_customers_created")
				.on(t.organizationId, t.createdAt, t.id)
				.where(sql`deleted_at IS NULL`),
			index("example_customers_name_order")
				.on(t.organizationId, sql`lower(name) COLLATE "C"`, t.id)
				.where(sql`deleted_at IS NULL`),
			index("example_customers_company_order")
				.on(
					t.organizationId,
					sql`(company IS NULL)`,
					sql`coalesce(lower(company),'') COLLATE "C"`,
					t.id,
				)
				.where(sql`deleted_at IS NULL`),
			...policies(),
		],
	)
	.enableRLS();
export const exampleCustomerOperations = tenancy
	.table(
		"example_customer_operations",
		{
			organizationId: uuid("organization_id").notNull(),
			actorId: text("actor_id").notNull(),
			operation: text().notNull(),
			operationKey: text("operation_key").notNull(),
			inputHash: text("input_hash").notNull(),
			customerId: uuid("customer_id").notNull(),
			createdAt: timestamp("created_at", { withTimezone: true })
				.notNull()
				.defaultNow(),
		},
		(t) => [
			primaryKey({
				columns: [t.organizationId, t.actorId, t.operation, t.operationKey],
			}),
			foreignKey({
				columns: [t.organizationId, t.customerId],
				foreignColumns: [exampleCustomers.organizationId, exampleCustomers.id],
			}),
			check(
				"example_customer_operation",
				sql`operation IN ('create','update','delete')`,
			),
			check("example_customer_hash", sql`input_hash ~ '^[0-9a-f]{64}$'`),
			...policies(),
		],
	)
	.enableRLS();

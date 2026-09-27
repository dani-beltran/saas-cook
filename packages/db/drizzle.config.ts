import { defineConfig } from "drizzle-kit";
export default defineConfig({
	dialect: "postgresql",
	schema: [
		"./packages/db/src/schema.ts",
		"./packages/db/src/tenancy-schema.ts",
		"./packages/db/src/resource-schema.ts",
		"./packages/db/src/example-customers/schema.ts",
	],
	out: "./packages/db/migrations",
	strict: true,
	verbose: true,
});

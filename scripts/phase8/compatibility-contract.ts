import { createHash } from "node:crypto";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { modelHash } from "../../packages/authz/src/model";
import { operatorModelHash } from "../../packages/authz/src/platform";
import { stripeApiVersion } from "../../packages/db/src/billing/stripe";

const digest = z.string().regex(/^[a-f0-9]{64}$/);
const manifestSchema = z.strictObject({
	version: z.literal(1),
	target: z.enum(["customer", "backoffice"]),
	applicationSchema: z.strictObject({
		min: z.number().int().positive(),
		max: z.number().int().positive(),
		historySha256: digest,
	}),
	operatorSchema: z.string().regex(/^\d{4}_[a-z0-9_]+$/),
	tenantModel: digest,
	operatorModel: digest.nullable(),
	controlContractSha256: digest,
	sharedServiceSha256: digest,
	protocols: z.strictObject({
		deletionJournal: z.literal(1),
		stripeApi: z.string().min(1),
	}),
	upgradePolicy: z.literal("initial-release-exact-contract"),
});

async function digestFiles(files: string[]) {
	const hash = createHash("sha256");
	for (const file of files.sort())
		hash
			.update(file)
			.update("\0")
			.update(await readFile(file))
			.update("\0");
	return hash.digest("hex");
}
async function sourceFiles(directory: string): Promise<string[]> {
	const files: string[] = [];
	for (const entry of await readdir(directory, { withFileTypes: true })) {
		const file = path.join(directory, entry.name);
		if (entry.isDirectory()) files.push(...(await sourceFiles(file)));
		else if (file.endsWith(".ts") && !file.endsWith(".test.ts"))
			files.push(file);
	}
	return files;
}

/**
 * Build deterministic compatibility metadata from current reviewed source files.
 * Run at the repository root; target selects which application owns the manifest.
 * Initial release permits exact contracts only, never guesses an older version pair.
 * Returns metadata without secrets; unreadable files or invalid journals throw.
 */
export async function compatibilityManifest(target: "customer" | "backoffice") {
	const journal = JSON.parse(
		await readFile("packages/db/migrations/meta/_journal.json", "utf8"),
	) as { entries: Array<{ idx: number; tag: string }> };
	if (
		!journal.entries.length ||
		journal.entries.some(
			(entry, index) =>
				entry.idx !== index || !/^\d{4}_[a-z0-9_]+$/.test(entry.tag),
		)
	)
		throw new Error("Invalid application migration journal");
	const schemas = journal.entries.map(
		({ tag }) => `packages/db/migrations/${tag}.sql`,
	);
	const operatorSchema = journal.entries.find(({ tag }) =>
		tag.endsWith("_backoffice_identity"),
	)?.tag;
	const shared = (
		await Promise.all(
			["db", "authz", "auth", "config", "api-contracts"].map((name) =>
				sourceFiles(`packages/${name}/src`),
			),
		)
	).flat();
	return manifestSchema.parse({
		version: 1,
		target,
		applicationSchema: {
			min: schemas.length,
			max: schemas.length,
			historySha256: await digestFiles([
				"packages/db/migrations/meta/_journal.json",
				...schemas,
			]),
		},
		operatorSchema,
		tenantModel: modelHash,
		operatorModel: target === "backoffice" ? operatorModelHash : null,
		controlContractSha256: await digestFiles([
			"packages/authz/src/control.ts",
			"packages/authz/src/journal.ts",
			"packages/authz/src/recovery.ts",
			"packages/authz/src/platform/schema.ts",
		]),
		sharedServiceSha256: await digestFiles(shared),
		protocols: { deletionJournal: 1, stripeApi: stripeApiVersion },
		upgradePolicy: "initial-release-exact-contract",
	});
}

/** Write the deterministic manifest into the selected build output; no database is contacted. */
export async function writeCompatibilityManifest(
	destination: string,
	target: "customer" | "backoffice",
) {
	await mkdir(path.dirname(destination), { recursive: true });
	await writeFile(
		destination,
		`${JSON.stringify(await compatibilityManifest(target), null, 2)}\n`,
	);
}

/**
 * Validate a proposed customer/Backoffice pair before deployment or rollback effects.
 * Unknown fields/versions, schema/model/protocol differences and changed compiled shared
 * services throw. This conservative first-release policy accepts only exact contracts.
 * Returns void on compatibility; it does not claim that deployment tests have passed.
 */
export function assertCompatiblePair(
	customerInput: unknown,
	backofficeInput: unknown,
) {
	const customer = manifestSchema.parse(customerInput);
	const backoffice = manifestSchema.parse(backofficeInput);
	if (
		customer.target !== "customer" ||
		backoffice.target !== "backoffice" ||
		customer.operatorModel !== null ||
		backoffice.operatorModel !== operatorModelHash
	)
		throw new Error("Unsupported application targets or operator model");
	for (const field of [
		"applicationSchema",
		"operatorSchema",
		"tenantModel",
		"controlContractSha256",
		"sharedServiceSha256",
		"protocols",
		"upgradePolicy",
	] as const)
		if (JSON.stringify(customer[field]) !== JSON.stringify(backoffice[field]))
			throw new Error(`Incompatible image contract: ${field}`);
}

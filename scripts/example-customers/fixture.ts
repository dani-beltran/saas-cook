import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { exampleCustomerInputs } from "../../packages/testing/src/example-customers/data";
import {
	type CustomerFixtureEnv,
	customerFixtureRuntime,
} from "../../packages/testing/src/example-customers/fixture";
import { createTestInstallation } from "../../packages/testing/src/installation";

// No organization/database argument: this command owns its newly-created disposable installation.
if (process.argv.length > 2)
	throw new Error(
		"Usage: bun run example-customers:fixture (no organization or database arguments)",
	);
const directory = resolve("artifacts/example-customers");
const receiptPath = resolve(directory, "fixture.json"),
	envPath = resolve(directory, "development.env");
type Receipt = {
	version: 1;
	env: CustomerFixtureEnv;
	organizationId?: string;
	email: string;
	operationKey: string;
};
await mkdir(directory, { recursive: true });
let receipt: Receipt;
try {
	receipt = JSON.parse(await readFile(receiptPath, "utf8"));
} catch (error) {
	if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
	const installation = await createTestInstallation();
	receipt = {
		version: 1,
		env: installation.env,
		email: "customers-developer@example.test",
		operationKey: randomUUID(),
	};
	// Record immediately, including interrupted setup. Never bootstrap an ambient installation.
	await writeFile(receiptPath, JSON.stringify(receipt, null, 2), {
		mode: 0o600,
		flag: "wx",
	});
}
if (receipt.version !== 1) throw new Error("Unsupported fixture receipt");
const origin = "http://localhost:3103";
const runtime = customerFixtureRuntime(receipt.env, origin);
try {
	await runtime.ready();
	const existing = await runtime.identityPool.query(
		'SELECT id FROM identity."user" WHERE email=$1 AND email_verified',
		[receipt.email],
	);
	const human = await runtime.human(receipt.email, !existing.rowCount);
	const organization = await runtime.tenancy.createOrganization(human.actor, {
		name: "Customers example · disposable",
		slug: `example-customers-${receipt.operationKey}`,
		operationKey: receipt.operationKey,
	});
	if (receipt.organizationId && receipt.organizationId !== organization.id)
		throw new Error("Fixture organization mismatch");
	receipt.organizationId = organization.id;
	await writeFile(receiptPath, JSON.stringify(receipt, null, 2), {
		mode: 0o600,
	});
	for (const input of exampleCustomerInputs())
		await runtime.exampleCustomers.create(human.actor, organization.id, input);
	const development = {
		...receipt.env,
		NODE_ENV: "development",
		APP_ORIGIN: origin,
		APP_NAME: "Common SaaS",
		DEFAULT_LOCALE: "en",
		PORT: "3103",
	};
	await writeFile(
		envPath,
		`${Object.entries(development)
			.map(([key, value]) => `${key}=${JSON.stringify(value)}`)
			.join("\n")}\n`,
		{ mode: 0o600 },
	);
	console.log(`90 synthetic customers ready. Environment: ${envPath}`);
	console.log(
		`Open ${origin}/en/organizations/${organization.id}/customers after starting the documented development command.`,
	);
} finally {
	await runtime.close();
}

import { randomUUID } from "node:crypto";
import { setTimeout } from "node:timers/promises";
import { Pool } from "pg";
import { expect, it } from "vitest";
import { dropTestDatabase } from "./database";

async function fixture() {
	const url = new URL(
		process.env.TEST_DATABASE_ADMIN_URL ??
			"postgres://postgres:local_phase1@127.0.0.1:55433/postgres",
	);
	const admin = new Pool({ connectionString: url.href });
	const name = `cleanup_test_${randomUUID().replaceAll("-", "")}`;
	await admin.query(`CREATE DATABASE ${name}`);
	url.pathname = `/${name}`;
	const client = new Pool({ connectionString: url.href });
	await client.query("SELECT 1");
	return { admin, client, name };
}

it("waits for live test connections to close without terminating them", async () => {
	const { admin, client, name } = await fixture();
	const errors: Error[] = [];
	client.on("error", (error) => errors.push(error));
	let finished = false;
	const cleanup = dropTestDatabase(admin, name).then(() => {
		finished = true;
	});
	try {
		await setTimeout(100);
		expect(finished).toBe(false);
		expect((await client.query("SELECT 42 AS value")).rows[0].value).toBe(42);
	} finally {
		await client.end();
		await cleanup;
		await admin.end();
	}
	expect(finished).toBe(true);
	expect(errors).toEqual([]);
});

it("reports a leaked connection and leaves that database usable", async () => {
	const { admin, client, name } = await fixture();
	try {
		await expect(dropTestDatabase(admin, name)).rejects.toThrow(
			"Disposable database still has open connections",
		);
		expect((await client.query("SELECT 42 AS value")).rows[0].value).toBe(42);
	} finally {
		await client.end();
		await dropTestDatabase(admin, name);
		await admin.end();
	}
});

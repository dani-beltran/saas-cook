import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

const candidate = path.resolve(process.argv[2]),
	reportPath = path.resolve(process.argv[3]);
const load = (file: string) =>
	import(pathToFileURL(path.join(candidate, file)).href);
const { resourceFixture } = await load("scripts/phase3/fixture.ts");
const { withTenantTransaction } = await load("packages/db/src/tenancy.ts");
const unsafe = await load("review-commercial/service.mjs");
const f = await resourceFixture();
const observations: {
	id: string;
	protectiveAssertion: string;
	observedFailure: boolean;
	details: string;
}[] = [];
const observe = (
	id: string,
	protectiveAssertion: string,
	work: () => void,
	details: string,
) => {
	let failed = false;
	try {
		work();
	} catch (error) {
		if (!(error instanceof assert.AssertionError)) throw error;
		failed = true;
	}
	assert.ok(failed, `Expected seeded defect did not reproduce: ${id}`);
	observations.push({
		id,
		protectiveAssertion,
		observedFailure: failed,
		details,
	});
};
try {
	const owner = await f.user(),
		member = await f.user();
	for (const actor of [owner, member])
		actor.assertCurrent = async () => new Date(Date.now() + 60000);
	const org = (await f.organization(owner)).id,
		other = (await f.organization(owner)).id;
	await f.member(owner, org, member);
	await f.app.query(
		await readFile(
			path.join(candidate, "review-commercial/schema.sql"),
			"utf8",
		),
	);
	const id = randomUUID();
	await f.app.query(
		"INSERT INTO tenancy.commercial_review_items VALUES($1,$2,'synthetic-private')",
		[id, other],
	);
	const leaked = await withTenantTransaction(
		f.web,
		org,
		[owner.userId],
		false,
		(c: unknown) => unsafe.listItems(c),
	);
	observe(
		"RLS",
		"Wrong-tenant row must be invisible under restricted runtime role",
		() => assert.equal(leaked.length, 0),
		`Restricted runtime query under organization ${org} returned synthetic row from ${other}.`,
	);
	const input = unsafe.publicInput({
		name: "allowed",
		serverSecret: "synthetic-private",
	});
	observe(
		"DTO",
		"Server field must be rejected or absent",
		() => assert.equal(input.serverSecret, undefined),
		"Unlisted serverSecret survived publicInput.",
	);
	const project = await f.resources.createProject(owner, org, {
		name: "Permission review",
		slug: `review-${randomUUID()}`,
		operationKey: randomUUID(),
	});
	await assert.rejects(f.resources.getProject(member, org, { id: project.id }));
	const exposed = await withTenantTransaction(
		f.web,
		org,
		[member.userId],
		false,
		(c: unknown) => unsafe.readProject(c, member, project.id),
	);
	observe(
		"PERMISSION",
		"Unshared Project must not be exposed to ordinary member",
		() => assert.equal(exposed, undefined),
		"Canonical service denied the member; unsafe query returned that same Project.",
	);
	observe(
		"ERASURE",
		"Missing person without completed deletion evidence must remain pending",
		() =>
			assert.equal(
				unsafe.erased({ personMissing: true, ingestionAcknowledged: false }),
				false,
			),
		"Unsafe erased returned true for a missing person without provider deletion completion.",
	);
	observe(
		"RESTORE",
		"Restored credential alone cannot establish current independent verification",
		() =>
			assert.equal(
				unsafe.restoreCredentials({
					credential: "synthetic-old",
					verified: false,
				}).verified,
				false,
			),
		"Unsafe restoreCredentials converted unverified saved material into verified credentials.",
	);
	const report = {
		version: 1,
		createdAt: new Date().toISOString(),
		environment:
			"uniquely identified disposable PostgreSQL/OpenFGA; restricted web role",
		observations,
	};
	await mkdir(path.join(candidate, "artifacts"), { recursive: true });
	await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`);
	await writeFile(
		path.join(candidate, "artifacts/review-observations.json"),
		`${JSON.stringify(report, null, 2)}\n`,
	);
	console.log(
		JSON.stringify({ passed: true, observedFailures: observations.length }),
	);
} finally {
	await f.cleanup();
}

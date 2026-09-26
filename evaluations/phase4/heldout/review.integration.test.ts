import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { afterAll, beforeAll, expect, it } from "vitest";

// biome-ignore lint/suspicious/noUndeclaredEnvVars: Disposable controller-owned review exercise.
const candidate = process.env.PHASE4_CANDIDATE_ROOT;
if (!candidate) throw new Error("A disposable candidate is required");
const load = (file: string) =>
	import(pathToFileURL(path.join(candidate, file)).href);
const { resourceFixture } = await load("scripts/phase3/fixture.ts");
const { listWidgets } = await load("artifacts/phase4-review/service.mjs");
let f: Awaited<ReturnType<typeof resourceFixture>>;
let owner: Awaited<ReturnType<typeof f.user>>;
let member: Awaited<ReturnType<typeof f.user>>;
let org: string;
let project: { id: string };

beforeAll(async () => {
	f = await resourceFixture();
	owner = await f.user();
	member = await f.user();
	org = (await f.organization(owner)).id;
	await f.member(owner, org, member);
	project = await f.resources.createProject(owner, org, {
		name: "Private review parent",
		slug: `review-${randomUUID()}`,
		operationKey: randomUUID(),
	});
	await f.app.query(
		await readFile(
			path.join(candidate, "artifacts/phase4-review/schema.sql"),
			"utf8",
		),
	);
	await f.app.query(
		"INSERT INTO tenancy.review_widgets VALUES($1,$2,$3,'Public label','SENSITIVE_REVIEW_SENTINEL')",
		[randomUUID(), org, project.id],
	);
});
afterAll(async () => f?.cleanup());

it("missing-rls: restricted SQL without context cannot read tenant rows", async () => {
	expect(
		(await f.web.query("SELECT * FROM tenancy.review_widgets")).rows,
	).toEqual([]);
});
it("dto-leak: public serialization strips internal fields", async () => {
	const rows = await listWidgets(f.web, owner, org);
	expect(rows).toHaveLength(1);
	expect(Object.keys(rows[0]).sort()).toEqual(["id", "project_id", "title"]);
	expect(JSON.stringify(rows)).not.toContain("SENSITIVE_REVIEW_SENTINEL");
});
it("missing-permission: membership cannot read a private Project child", async () => {
	await expect(
		f.resources.getProject(member, org, { id: project.id }),
	).rejects.toThrow();
	await expect(listWidgets(f.web, member, org)).rejects.toThrow();
});

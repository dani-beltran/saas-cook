import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { Pool } from "pg";
import { afterAll, beforeAll, expect, it } from "vitest";
import { createAnalyticsService } from "../../../packages/db/src/analytics/service";
import { createBulkService } from "../../../packages/db/src/bulk/service";

const { createCommercialWorkflows } = await import(
	pathToFileURL(
		path.join(process.cwd(), "packages/db/src/commercial-workflows.ts"),
	).href
);

import { createFileService } from "../../../packages/db/src/files/service";
import { configuredFileStorage } from "../../../packages/db/src/files/storage";
import { createLifecycleService } from "../../../packages/db/src/lifecycle/service";
import { createPlatformService } from "../../../packages/db/src/platform/service";
import { createResourceService } from "../../../packages/db/src/resources";
import { withTenantTransaction } from "../../../packages/db/src/tenancy";
import { createTestFileStorage } from "../../../packages/testing/src/file-storage";
import { resourceFixture } from "../../../scripts/phase3/fixture";

let f: Awaited<ReturnType<typeof resourceFixture>>;
let lifecyclePool: Pool, worker: Pool;
let bucket: Awaited<ReturnType<typeof createTestFileStorage>>;
let workflow: ReturnType<typeof createCommercialWorkflows>;
let lifecycle: ReturnType<typeof createLifecycleService>;
let analytics: ReturnType<typeof createAnalyticsService>;
let actor: Awaited<ReturnType<typeof f.user>> & {
	sessionId: string;
	recoveryEpoch: string;
};
let member: Awaited<ReturnType<typeof f.user>>;
let org: string, other: string, membership: string;
beforeAll(async () => {
	f = await resourceFixture();
	const owner = await f.user();
	actor = {
		...owner,
		sessionId: randomUUID(),
		recoveryEpoch: (
			await f.app.query("SELECT recovery_epoch FROM foundation.installation")
		).rows[0].recovery_epoch,
		assertCurrent: async () => new Date(Date.now() + 60000),
	};
	member = await f.user();
	member.assertCurrent = async () => new Date(Date.now() + 60000);
	org = (await f.organization(actor)).id;
	other = (await f.organization(actor)).id;
	membership = await f.member(actor, org, member);
	const url = new URL(f.installation.env.DATABASE_URL);
	url.username = "saas_cook_lifecycle";
	lifecyclePool = new Pool({ connectionString: url.toString() });
	worker = new Pool({
		connectionString: f.installation.env.WORKER_DATABASE_URL,
	});
	const hooks = {
		authorize: f.authorization.authorizeResource,
		check: f.authorization.checkResource,
		checkBatch: f.authorization.checkResourceBatch,
		sourceCommit: f.authorization.sourceCommit,
	};
	bucket = await createTestFileStorage("http://localhost:3000");
	const storage = configuredFileStorage(bucket.env);
	const files = createFileService(f.web, hooks, { storage });
	const bulk = createBulkService(worker, hooks, {
		secret: f.installation.env.AUTH_SECRET,
		storage,
		files,
		resources: createResourceService(worker, hooks),
		ready: f.authorization.publication,
		resolveActor: async () => actor,
		auditExport: async () => {
			throw new Error("Grant required");
		},
	});
	const platform = createPlatformService(f.web, hooks, {
		cursorSecret: "synthetic-commercial-cursors",
	});
	lifecycle = createLifecycleService(lifecyclePool, hooks, {
		secret: "synthetic-commercial-receipt",
		journal: {
			async append() {
				throw new Error("Journal not configured for preparation");
			},
		},
	});
	analytics = createAnalyticsService(lifecyclePool, hooks, {
		enabled: false,
		secret: "synthetic-commercial-analytics",
		synthetic: true,
		ready: f.authorization.publication,
		registry: {
			async register() {
				throw new Error("Disabled");
			},
			async settle() {
				throw new Error("Disabled");
			},
			async unsettled() {
				return [];
			},
			async list() {
				return [];
			},
		},
	});
	workflow = createCommercialWorkflows({
		bulk,
		platform,
		lifecycle,
		analytics,
	});
});
afterAll(async () => {
	await Promise.all([lifecyclePool?.end(), worker?.end()]);
	await bucket?.cleanup();
	await f?.cleanup();
});
it("phase6-task-01 data-job-replay-and-strict-input", async () => {
	const input = {
		kind: "projects.export" as const,
		operationKey: randomUUID(),
	};
	const first = await workflow.startDataJob(actor, org, input);
	expect((await workflow.startDataJob(actor, org, input)).id).toBe(first.id);
	expect(
		(
			await f.app.query(
				"SELECT count(*)::int AS n FROM tenancy.bulk_jobs WHERE id=$1",
				[first.id],
			)
		).rows[0].n,
	).toBe(1);
	await expect(
		workflow.startDataJob(actor, org, {
			...input,
			operationKey: randomUUID(),
			requesterId: member.userId,
		} as typeof input),
	).rejects.toThrow();
	await expect(
		workflow.startDataJob(member, other, {
			...input,
			operationKey: randomUUID(),
		}),
	).rejects.toThrow();
	expect(first).not.toHaveProperty("input");
});
it("phase6-task-02 discovery-current-authority-and-redaction", async () => {
	const project = await f.resources.createProject(actor, org, {
		name: "Commercial discovery",
		slug: `discovery-${randomUUID()}`,
		description: "private-description",
		operationKey: randomUUID(),
	});
	const query = { query: "Commercial" };
	expect(
		(await workflow.discovery(member, org, query)).items.some(
			(r) => r.id === project.id,
		),
	).toBe(false);
	const grant = await f.resources.grant(actor, org, {
		resourceId: project.id,
		subject: { kind: "membership", id: membership },
		relation: "viewer",
		operationKey: randomUUID(),
	});
	const page = await workflow.discovery(member, org, query);
	expect(page.items.some((r) => r.id === project.id)).toBe(true);
	expect(page).not.toHaveProperty("total");
	expect(JSON.stringify(page)).not.toContain("private-description");
	await f.resources.revokeGrant(actor, org, { grantId: grant.id });
	expect(
		(await workflow.discovery(member, org, query)).items.some(
			(r) => r.id === project.id,
		),
	).toBe(false);
	await expect(workflow.discovery(member, other, query)).rejects.toThrow();
});
it("phase6-task-02 activity-current-authority-and-tenant", async () => {
	const project = await f.resources.createProject(actor, org, {
		name: "Activity subject",
		slug: `activity-${randomUUID()}`,
		operationKey: randomUUID(),
	});
	const input = { resourceType: "project" as const, resourceId: project.id };
	expect((await workflow.activity(actor, org, input)).items).toHaveLength(1);
	await expect(workflow.activity(member, org, input)).rejects.toThrow();
	await expect(workflow.activity(actor, other, input)).rejects.toThrow();
});
it("phase6-task-03 departure-preview-replay-and-continuity", async () => {
	const input = { kind: "account" as const, operationKey: randomUUID() };
	const first = await workflow.prepareDeparture(actor, input);
	expect(first.preview.some((r) => r.requiresSuccessor)).toBe(true);
	expect(first.request.state).toBe("awaiting_prerequisites");
	expect((await workflow.prepareDeparture(actor, input)).request.id).toBe(
		first.request.id,
	);
	await expect(lifecycle.confirm(actor, first.request.id)).rejects.toThrow();
	await expect(
		workflow.prepareDeparture(actor, {
			...input,
			kind: "organization",
			organizationId: org,
		}),
	).rejects.toThrow();
	await expect(
		workflow.prepareDeparture(actor, {
			...input,
			serverOwned: true,
		} as typeof input),
	).rejects.toThrow();
	expect((await lifecycle.cancel(actor, first.request.id)).state).toBe(
		"canceled",
	);
	expect(
		(
			await f.app.query(
				"SELECT status FROM tenancy.organizations WHERE id=$1",
				[org],
			)
		).rows[0].status,
	).toBe("active");
	expect(
		(
			await f.identity.query(
				'SELECT lifecycle_status FROM identity."user" WHERE id=$1',
				[actor.userId],
			)
		).rows[0].lifecycle_status,
	).toBe("active");
});
it("phase6-task-04 authoritative-analytics-preferences", async () => {
	const first = await workflow.setAnalyticsPreference(actor, org, {
		enabled: false,
		version: 0,
	});
	expect(first).toMatchObject({
		enabled: false,
		version: 1,
		configured: false,
	});
	await expect(
		workflow.setAnalyticsPreference(actor, org, { enabled: true, version: 0 }),
	).rejects.toThrow();
	await expect(
		workflow.setAnalyticsPreference(member, org, { enabled: true, version: 1 }),
	).rejects.toThrow();
	await expect(
		workflow.setAnalyticsPreference(actor, org, {
			enabled: true,
			version: 1,
			subjectId: other,
		} as { enabled: boolean; version: number }),
	).rejects.toThrow();
	expect((await analytics.preferences(actor, null)).enabled).toBe(true);
	expect((await analytics.preferences(actor, org)).enabled).toBe(false);
});
it("phase6-task-05 five-observable-seeded-defects-and-diagnosis", async () => {
	// The immutable unsafe fixture must visibly fail each intended protection.
	const unsafe = await import(
		pathToFileURL(path.join(process.cwd(), "review-commercial/service.mjs"))
			.href
	);
	await f.app.query(await readFile("review-commercial/schema.sql", "utf8"));
	const id = randomUUID();
	await f.app.query(
		"INSERT INTO tenancy.commercial_review_items VALUES($1,$2,$3)",
		[id, other, "cross-tenant-secret"],
	);
	const leaked = await withTenantTransaction(
		f.web,
		org,
		[actor.userId],
		false,
		(c) => unsafe.listItems(c),
	);
	expect(leaked.some((r: { id: string }) => r.id === id)).toBe(true);
	expect(
		unsafe.publicInput({ name: "ok", serverSecret: "leaked" }).serverSecret,
	).toBe("leaked");
	const project = await f.resources.createProject(actor, org, {
		name: "Denied project",
		slug: `denied-${randomUUID()}`,
		operationKey: randomUUID(),
	});
	await expect(
		f.resources.getProject(member, org, { id: project.id }),
	).rejects.toThrow();
	const exposed = await withTenantTransaction(
		f.web,
		org,
		[member.userId],
		false,
		(c) => unsafe.readProject(c, member, project.id),
	);
	expect(exposed.id).toBe(project.id);
	expect(
		unsafe.erased({ personMissing: true, ingestionAcknowledged: false }),
	).toBe(true);
	expect(
		unsafe.restoreCredentials({ credential: "obsolete", verified: false })
			.verified,
	).toBe(true);
	const report = await readFile(
		"docs/feature-briefs/commercial-review.md",
		"utf8",
	);
	for (const pattern of [
		/RLS|row.level/i,
		/DTO|server.*field|extra.*field/i,
		/permission|authoriz/i,
		/eras|delet/i,
		/restor.*credential|credential.*restor/i,
	])
		expect(report).toMatch(pattern);
	expect(report.length).toBeGreaterThan(1200);
});

it("phase6-preservation customized localized support behavior", () => {
	expect(workflow.supportCopy("en")).toBe(
		"Custom commercial support: CASE-6801",
	);
	expect(workflow.supportCopy("es")).toBe(
		"Soporte comercial personalizado: CASE-6801",
	);
});

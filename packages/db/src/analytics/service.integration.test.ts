import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { afterAll, beforeAll, expect, it } from "vitest";
import { resourceFixture } from "../../../../scripts/phase3/fixture";
import { withTenantTransaction } from "../tenancy";
import type { AnalyticsEvent } from "./provider";
import { createAnalyticsService } from "./service";

let f: Awaited<ReturnType<typeof resourceFixture>>, pool: Pool, writer: Pool;
let owner: Awaited<ReturnType<typeof f.user>>, org: string, other: string;
const captured: AnalyticsEvent[] = [];
let uncertain = false;
let deleted = false;
let observed = false;
let deletionRequests = 0;
let service: ReturnType<typeof createAnalyticsService>;
let configuration: Parameters<typeof createAnalyticsService>[2];
let verificationCalls = 0;
let verificationOutage = false;
const due = () =>
	pool.query(
		"UPDATE foundation.analytics_subjects SET receipt=jsonb_set(receipt,'{verification,nextCheckAt}','\"2000-01-01T00:00:00Z\"') WHERE receipt->'verification' IS NOT NULL",
	);
beforeAll(async () => {
	f = await resourceFixture();
	const u = new URL(f.installation.env.DATABASE_URL);
	u.username = "saas_cook_lifecycle";
	pool = new Pool({ connectionString: u.toString() });
	const w = new URL(f.installation.controlUrl);
	w.username = "saas_cook_journal_writer";
	writer = new Pool({ connectionString: w.toString() });
	owner = await f.user();
	owner.assertCurrent = async () => new Date(Date.now() + 60000);
	org = (await f.organization(owner)).id;
	other = (await f.organization(owner)).id;
	configuration = {
		enabled: true,
		secret: "synthetic-analytics-key-0000000000000000",
		synthetic: true,
		ready: f.authorization.publication,
		registry: {
			async register(id, user, organization, event) {
				await writer.query("SELECT control.begin_analytics($1,$2,$3,$4,$5)", [
					f.installation.env.INSTALLATION_ID,
					id,
					user,
					organization,
					event,
				]);
			},
			async settle(event) {
				await writer.query("SELECT control.settle_analytics($1,$2)", [
					f.installation.env.INSTALLATION_ID,
					event,
				]);
			},
			async unsettled(subject) {
				return (
					await f.reader.query(
						"SELECT id FROM control.analytics_attempts WHERE installation_id=$1 AND subject_id=$2 AND NOT settled",
						[f.installation.env.INSTALLATION_ID, subject],
					)
				).rows.map((r) => r.id as string);
			},
			async list(kind, id) {
				return (
					await f.reader.query(
						"SELECT id,user_id,organization_id FROM control.analytics_subjects WHERE installation_id=$1 AND (($2='account' AND user_id=$3) OR ($2='organization' AND organization_id::text=$3))",
						[f.installation.env.INSTALLATION_ID, kind, id],
					)
				).rows;
			},
		},
		provider: {
			async capture(e) {
				captured.push(e);
				if (uncertain) throw new Error("lost acknowledgement");
			},
			async confirmIngested() {
				return observed;
			},
			async requestDeletion(_id, previous) {
				deletionRequests++;
				return (
					previous ?? {
						personIds: ["provider-person"],
						requestedAt: new Date().toISOString(),
					}
				);
			},
			async deletionComplete() {
				verificationCalls++;
				if (verificationOutage) throw new Error("provider unavailable");
				return deleted;
			},
		},
	};
	service = createAnalyticsService(
		pool,
		{ authorize: f.authorization.authorizeResource },
		configuration,
	);
});
afterAll(async () => {
	await Promise.all([pool?.end(), writer?.end()]);
	await f?.cleanup();
});
const capture = async (id: string, organization = org) =>
	withTenantTransaction(pool, organization, [owner.userId], false, (c) =>
		service.capture(c, {
			id,
			user: owner.userId,
			organization,
			event: "core_action.completed",
			feature: "projects",
			occurredAt: new Date(),
		}),
	);
it("deduplicates and respects authoritative user/org preferences at capture and retry", async () => {
	const id = randomUUID();
	await capture(id);
	await capture(id);
	expect(
		(
			await pool.query(
				"SELECT * FROM foundation.analytics_events WHERE id=$1",
				[id],
			)
		).rows,
	).toHaveLength(1);
	const p = await service.preferences(owner, org);
	await service.setPreference(owner, org, {
		enabled: false,
		version: p.version,
	});
	await service.deliver();
	expect(captured).toHaveLength(0);
	const otherId = randomUUID();
	await capture(otherId, other);
	await service.deliver();
	expect(captured).toHaveLength(1);
	expect(JSON.stringify(captured)).not.toContain(owner.userId);
	expect(JSON.stringify(captured)).not.toContain(other);
	await expect(
		service.setPreference(owner, org, { enabled: true, version: p.version }),
	).rejects.toMatchObject({ code: "CONFLICT" });
});
it("keeps cleanup pending for provider outage, scopes org deletion, and preserves independent post-backup mappings", async () => {
	expect(await service.suppress("organization", other)).toBe(false);
	deleted = true;
	await due();
	expect(await service.suppress("organization", other)).toBe(true);
	await capture(randomUUID(), other);
	await service.deliver();
	expect(captured).toHaveLength(1);
	const local = (
		await pool.query(
			"SELECT id FROM foundation.analytics_subjects WHERE organization_id=$1",
			[other],
		)
	).rows[0];
	await pool.query(
		"DELETE FROM foundation.analytics_events WHERE subject_id=$1",
		[local.id],
	);
	await pool.query("DELETE FROM foundation.analytics_subjects WHERE id=$1", [
		local.id,
	]);
	expect(await service.suppress("organization", other)).toBe(true);
	expect(
		(
			await pool.query(
				"SELECT suppressed FROM foundation.analytics_subjects WHERE id=$1",
				[local.id],
			)
		).rows[0].suppressed,
	).toBe(true);
});
it("does not certify erasure after a possibly late write", async () => {
	const p = await service.preferences(owner, org);
	await service.setPreference(owner, org, {
		enabled: true,
		version: p.version,
	});
	uncertain = true;
	await capture(randomUUID());
	await service.deliver();
	const before = deletionRequests;
	expect(await service.suppress("account", owner.userId)).toBe(false);
	expect(deletionRequests).toBe(before);
	// Restore may remove the local ambiguous attempt; the independent ledger must still block erasure.
	await pool.query(
		"DELETE FROM foundation.analytics_events WHERE state='ambiguous'",
	);
	expect(await service.suppress("account", owner.userId)).toBe(false);
	observed = true;
	expect(await service.suppress("account", owner.userId)).toBe(true);
	expect(deletionRequests).toBeGreaterThan(before);
	await expect(
		f.web.query("SELECT * FROM foundation.analytics_events"),
	).rejects.toMatchObject({ code: "42501" });
});

it("captures the actual committed business catalogue and excludes a rolled-back source", async () => {
	const user = await f.user();
	user.assertCurrent = async () => new Date(Date.now() + 60000);
	const organization = (await f.organization(user)).id;
	const project = await f.resources.createProject(user, organization, {
		name: "Analytics source",
		slug: "analytics-source",
		operationKey: randomUUID(),
	});
	const rows = (
		await pool.query(
			"SELECT event,feature FROM foundation.analytics_sources WHERE user_id=$1",
			[user.userId],
		)
	).rows;
	expect(rows).toEqual(
		expect.arrayContaining([
			{ event: "account.signed_up", feature: null },
			{ event: "organization.created", feature: null },
			{ event: "core_action.completed", feature: "projects" },
		]),
	);
	for (const [action, feature] of [
		["example-customers.create", "customers"],
		["file.available", "files"],
	]) {
		const id = randomUUID();
		await withTenantTransaction(f.app, organization, [], true, (c) =>
			c.query(
				"INSERT INTO tenancy.audit_events(id,organization_id,actor_id,action,target_id,changes) VALUES($1,$2,$3,$4,$5,'{}')",
				[id, organization, `user:${user.userId}`, action, project.id],
			),
		);
		expect(
			(
				await pool.query(
					"SELECT feature FROM foundation.analytics_sources WHERE id=$1",
					[id],
				)
			).rows[0].feature,
		).toBe(feature);
	}
	const rolledBack = randomUUID();
	await expect(
		withTenantTransaction(f.app, organization, [], true, async (c) => {
			await c.query(
				"INSERT INTO tenancy.audit_events(id,organization_id,actor_id,action,target_id,changes) VALUES($1,$2,$3,'file.available',$4,'{}')",
				[rolledBack, organization, `user:${user.userId}`, project.id],
			);
			throw new Error("rollback");
		}),
	).rejects.toThrow("rollback");
	expect(
		(
			await pool.query(
				"SELECT 1 FROM foundation.analytics_sources WHERE id=$1",
				[rolledBack],
			)
		).rowCount,
	).toBe(0);
});

it("resumes durable verification after restart, backs off outages, alerts overdue and never resubmits an accepted request", async () => {
	const user = await f.user();
	const organization = (await f.organization(user)).id;
	uncertain = false;
	deleted = false;
	await withTenantTransaction(pool, organization, [user.userId], false, (c) =>
		service.capture(c, {
			id: randomUUID(),
			user: user.userId,
			organization,
			event: "core_action.completed",
			feature: "projects",
			occurredAt: new Date(),
		}),
	);
	await service.deliver();
	const before = deletionRequests;
	const restarted = createAnalyticsService(
		pool,
		{ authorize: f.authorization.authorizeResource },
		configuration,
	);
	expect(
		await Promise.all([
			service.suppress("organization", organization),
			restarted.suppress("organization", organization),
		]),
	).toEqual([false, false]);
	expect(deletionRequests).toBe(before + 1);
	const row = async () =>
		(
			await pool.query(
				"SELECT * FROM foundation.analytics_subjects WHERE organization_id=$1",
				[organization],
			)
		).rows[0];
	const first = await row();
	expect(first.receipt.verification).toMatchObject({
		attempts: 1,
		outcome: "pending",
	});
	const checks = verificationCalls;
	await restarted.verifyErasures();
	expect(verificationCalls).toBe(checks);
	expect(deletionRequests).toBe(before + 1);
	verificationOutage = true;
	await due();
	await restarted.verifyErasures();
	expect((await row()).receipt.verification).toMatchObject({
		attempts: 2,
		outcome: "error",
	});
	expect((await row()).deletion_state).toBe("pending");
	expect(
		Date.parse((await row()).receipt.verification.nextCheckAt) - Date.now(),
	).toBeGreaterThan(7100000);
	await pool.query(
		"UPDATE foundation.analytics_subjects SET receipt=jsonb_set(receipt,'{requestedAt}',to_jsonb((clock_timestamp()-interval '8 days')::text)) WHERE organization_id=$1",
		[organization],
	);
	expect(await restarted.verifyErasures()).toEqual({ overdue: 1 });
	expect(await restarted.verifyErasures()).toEqual({ overdue: 0 });
	expect((await row()).receipt.verification.alertedAt).toBeTruthy();
	verificationOutage = false;
	await due();
	const count = verificationCalls;
	await Promise.all([service.verifyErasures(), restarted.verifyErasures()]);
	expect(verificationCalls).toBe(count + 1);
	deleted = true;
	await due();
	await restarted.verifyErasures();
	const final = await row();
	expect(final.deletion_state).toBe("complete");
	expect(final.receipt.personIds).toEqual(first.receipt.personIds);
	expect(final.receipt.verification).toMatchObject({
		outcome: "verified",
		attempts: 4,
	});
	expect(final.receipt.verification.verifiedAt).toBeTruthy();
	expect(deletionRequests).toBe(before + 1);
	expect(
		(
			await pool.query(
				"SELECT * FROM foundation.analytics_events WHERE subject_id=$1",
				[final.id],
			)
		).rows,
	).toHaveLength(0);
});

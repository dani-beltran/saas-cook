import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { resourceFixture } from "../../../../scripts/phase3/fixture";
import {
	appendDeletion,
	readDeletionJournal,
} from "../../../authz/src/journal";
import { advanceDeletion, createLifecycleService } from "./service";

let f: Awaited<ReturnType<typeof resourceFixture>>;
let lifecycle: Pool, control: Pool, writer: Pool;
let service: ReturnType<typeof createLifecycleService>;
let journalAvailable = true;
const journal = {
	async append(key: string, record: Parameters<typeof appendDeletion>[3]) {
		if (!journalAvailable) throw new Error("outage");
		return appendDeletion(
			writer,
			f.installation.env.INSTALLATION_ID,
			key,
			record,
		);
	},
};
beforeAll(async () => {
	f = await resourceFixture();
	const url = new URL(f.installation.env.DATABASE_URL);
	url.username = "saas_cook_lifecycle";
	lifecycle = new Pool({ connectionString: url.toString() });
	control = new Pool({ connectionString: f.installation.controlUrl });
	const w = new URL(f.installation.controlUrl);
	w.username = "saas_cook_journal_writer";
	writer = new Pool({ connectionString: w.toString() });
	service = createLifecycleService(
		lifecycle,
		{
			authorize: f.authorization.authorizeResource,
			sourceCommit: f.authorization.sourceCommit,
		},
		{ secret: "synthetic-status-secret", journal },
	);
});
afterAll(async () => {
	await Promise.all([lifecycle?.end(), control?.end(), writer?.end()]);
	await f?.cleanup();
});
const user = async () => {
	const a = await f.user();
	a.assertCurrent = async () => new Date(Date.now() + 60000);
	return a;
};
describe("independent journal and deletion", () => {
	it("blocks a sole owner, allows cancellation before freeze, and denies other users", async () => {
		const a = await user(),
			b = await user();
		const org = await f.organization(a);
		const request = await service.request(a, {
			kind: "account",
			operationKey: randomUUID(),
		});
		expect((await service.preview(a))[0].requiresSuccessor).toBe(true);
		await expect(service.confirm(a, request.id)).rejects.toMatchObject({
			code: "CONFLICT",
		});
		await expect(service.confirm(b, request.id)).rejects.toThrow();
		await expect(service.status(request.id, "x".repeat(43))).rejects.toThrow();
		expect((await service.cancel(a, request.id)).state).toBe("canceled");
		expect((await f.resources.listProjects(a, org.id, {})).items).toEqual([]);
	});
	it("freezes on journal outage, never purges early, and releases seats exactly once without deleting shared content", async () => {
		const owner = await user(),
			departing = await user();
		const org = await f.organization(owner);
		await f.member(owner, org.id, departing);
		const project = await f.resources.createProject(owner, org.id, {
			name: "Keep shared content",
			slug: `p-${randomUUID()}`,
			operationKey: randomUUID(),
		});
		const request = await service.request(departing, {
			kind: "account",
			operationKey: randomUUID(),
		});
		journalAvailable = false;
		expect((await service.confirm(departing, request.id)).state).toBe(
			"journal_pending",
		);
		let calls = 0;
		await advanceDeletion(
			lifecycle,
			journal,
			{
				async cleanup() {
					calls++;
					return true;
				},
			},
			request.id,
		);
		expect(calls).toBe(0);
		expect(
			(
				await f.identity.query(
					'SELECT lifecycle_status FROM identity."user" WHERE id=$1',
					[departing.userId],
				)
			).rows[0].lifecycle_status,
		).toBe("frozen");
		await expect(
			f.resources.listProjects(departing, org.id, {}),
		).rejects.toThrow();
		expect(
			(
				await f.app.query(
					"SELECT occupied FROM tenancy.seat_capacities WHERE organization_id=$1",
					[org.id],
				)
			).rows[0].occupied,
		).toBe(1);
		journalAvailable = true;
		await service.acknowledge(request.id);
		await service.acknowledge(request.id);
		await advanceDeletion(
			lifecycle,
			journal,
			{
				async cleanup(r, step) {
					calls++;
					if (step === "local")
						await lifecycle.query(
							"SELECT foundation.lifecycle_identity($1,true)",
							[r.id],
						);
					return true;
				},
			},
			request.id,
		);
		await advanceDeletion(
			lifecycle,
			journal,
			{
				async cleanup() {
					calls++;
					return true;
				},
			},
			request.id,
		);
		expect(calls).toBe(5);
		expect((await service.status(request.id, request.receipt)).state).toBe(
			"complete",
		);
		expect(
			(await f.resources.getProject(owner, org.id, { id: project.id })).name,
		).toBe("Keep shared content");
		const entries = await readDeletionJournal(
			f.reader,
			f.installation.env.INSTALLATION_ID,
		);
		expect(
			entries.entries.filter((e) => e.record.requestId === request.id),
		).toHaveLength(7);
		await expect(
			writer.query("UPDATE control.deletion_journal SET payload='{}'"),
		).rejects.toMatchObject({ code: "42501" });
		await expect(
			f.web.query("SELECT * FROM foundation.deletion_requests"),
		).rejects.toMatchObject({ code: "42501" });
	});
	it("requires current owner authority for org deletion and leaves provider-pending work incomplete", async () => {
		const a = await user(),
			b = await user();
		const org = await f.organization(a);
		await f.member(a, org.id, b);
		await expect(
			service.request(b, {
				kind: "organization",
				organizationId: org.id,
				operationKey: randomUUID(),
			}),
		).rejects.toThrow();
		const r = await service.request(a, {
			kind: "organization",
			organizationId: org.id,
			operationKey: randomUUID(),
		});
		await service.confirm(a, r.id);
		await expect(f.resources.listProjects(a, org.id, {})).rejects.toThrow();
		await advanceDeletion(
			lifecycle,
			journal,
			{
				async cleanup(_r, step) {
					return step !== "billing";
				},
			},
			r.id,
		);
		const status = await service.status(r.id, r.receipt);
		expect(status.state).toBe("purging");
		expect(status.steps).toEqual(["files", "analytics"]);
		expect(status.backupExpiry).toBe("not-confirmed");
	});
	it("detects a missing journal record against the independently retained head", async () => {
		const entry = (
			await readDeletionJournal(f.reader, f.installation.env.INSTALLATION_ID)
		).entries.at(-1);
		expect(entry).toBeTruthy();
		await control.query(
			"DELETE FROM control.deletion_journal WHERE installation_id=$1 AND sequence=$2",
			[f.installation.env.INSTALLATION_ID, entry?.sequence],
		);
		await expect(
			readDeletionJournal(f.reader, f.installation.env.INSTALLATION_ID),
		).rejects.toThrow("Incomplete deletion journal");
	});
});

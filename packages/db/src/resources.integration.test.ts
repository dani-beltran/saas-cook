import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { resourceFixture } from "../../../scripts/phase3/fixture";
import {
	createResourceService,
	expireCapacityReservations,
	reserveCapacity,
	settleCapacityReservation,
} from "./resources";
import { withTenantTransaction } from "./tenancy";

const cleanup: Array<() => Promise<void>> = [];
afterEach(async () => {
	for (const action of cleanup.splice(0).reverse()) await action();
});
async function fixture(capacity: number | null = 100) {
	const f = await resourceFixture({ defaultProjectCapacity: capacity });
	cleanup.push(f.cleanup);
	const owner = await f.user(),
		member = await f.user(),
		outsider = await f.user();
	const org = (await f.organization(owner)).id,
		otherOrg = (await f.organization(outsider)).id;
	const membership = await f.member(owner, org, member);
	const create = (actor = owner, name = "Project") =>
		f.resources.createProject(actor, org, {
			name,
			slug: `p-${randomUUID()}`,
			operationKey: randomUUID(),
		});
	return { ...f, owner, member, outsider, org, otherOrg, membership, create };
}

describe("Phase 3 resource policy with restricted PostgreSQL and real OpenFGA", () => {
	it("enforces disabled, zero and unlimited local policy independently of permissions", async () => {
		const f = await fixture();
		await expect(
			f.resources.setProjectPolicy(f.member, f.org, {
				enabled: true,
				maxActive: null,
			}),
		).rejects.toThrow();
		await f.resources.setProjectPolicy(f.owner, f.org, {
			enabled: false,
			maxActive: 10,
		});
		await expect(f.create()).rejects.toThrow();
		await f.resources.setProjectPolicy(f.owner, f.org, {
			enabled: true,
			maxActive: 0,
		});
		await expect(f.create()).rejects.toThrow();
		await f.resources.setProjectPolicy(f.owner, f.org, {
			enabled: true,
			maxActive: null,
		});
		const p = await f.create();
		await expect(
			f.resources.getProject(f.member, f.org, { id: p.id }),
		).rejects.toThrow();
	});
	it("reserves, releases and expires generic capacity exactly once using the same database boundary", async () => {
		const f = await fixture();
		const bucket = randomUUID();
		await f.app.query(
			"INSERT INTO tenancy.capacity_buckets(id,organization_id,feature,policy_kind,capacity) VALUES($1,$2,'test.bytes','limited',2)",
			[bucket, f.org],
		);
		const transaction = <T>(
			work: Parameters<typeof withTenantTransaction<T>>[4],
		) => withTenantTransaction(f.web, f.org, [f.owner.userId], true, work);
		const key = randomUUID();
		const first = await transaction((c) =>
			reserveCapacity(
				c,
				f.org,
				"test.bytes",
				key,
				2,
				new Date(Date.now() + 60_000),
			),
		);
		expect(
			await transaction((c) =>
				reserveCapacity(
					c,
					f.org,
					"test.bytes",
					key,
					2,
					new Date(Date.now() + 60_000),
				),
			),
		).toBe(first);
		await expect(
			transaction((c) =>
				reserveCapacity(
					c,
					f.org,
					"test.bytes",
					randomUUID(),
					1,
					new Date(Date.now() + 60_000),
				),
			),
		).rejects.toThrow();
		await transaction((c) =>
			settleCapacityReservation(c, f.org, first, "released"),
		);
		await transaction((c) =>
			settleCapacityReservation(c, f.org, first, "released"),
		);
		const expiring = await transaction((c) =>
			reserveCapacity(
				c,
				f.org,
				"test.bytes",
				randomUUID(),
				2,
				new Date(Date.now() + 60_000),
			),
		);
		await f.app.query(
			"UPDATE tenancy.capacity_reservations SET expires_at=clock_timestamp()-interval '1 second' WHERE id=$1",
			[expiring],
		);
		await expect(
			transaction((c) =>
				settleCapacityReservation(c, f.org, expiring, "committed"),
			),
		).rejects.toThrow();
		await transaction((c) => expireCapacityReservations(c, f.org, bucket));
		await transaction((c) => expireCapacityReservations(c, f.org, bucket));
		expect(
			(
				await f.app.query(
					"SELECT consumed,reserved FROM tenancy.capacity_buckets WHERE id=$1",
					[bucket],
				)
			).rows[0],
		).toEqual({ consumed: 0, reserved: 0 });
	});
	it("disables positive Project writes while preserving reads and security cleanup", async () => {
		const f = await fixture();
		const p = await f.create();
		const ws = await f.resources.createWorkspace(f.owner, f.org, {
			name: "Workspace",
			slug: "workspace",
			operationKey: randomUUID(),
		});
		const viewer = await f.resources.grant(f.owner, f.org, {
			resourceId: p.id,
			subject: { kind: "membership", id: f.membership },
			relation: "viewer",
			operationKey: randomUUID(),
		});
		await f.resources.setProjectPolicy(f.owner, f.org, {
			enabled: false,
			maxActive: null,
		});
		expect(
			(await f.resources.getProject(f.member, f.org, { id: p.id })).id,
		).toBe(p.id);
		await expect(
			f.resources.updateProject(f.owner, f.org, {
				id: p.id,
				version: p.version,
				name: "Disabled",
			}),
		).rejects.toMatchObject({ code: "DISABLED" });
		await expect(
			f.resources.moveProject(f.owner, f.org, {
				id: p.id,
				version: p.version,
				workspaceId: ws.id,
			}),
		).rejects.toMatchObject({ code: "DISABLED" });
		await expect(
			f.resources.grant(f.owner, f.org, {
				resourceId: p.id,
				subject: { kind: "membership", id: f.membership },
				relation: "editor",
				operationKey: randomUUID(),
			}),
		).rejects.toMatchObject({ code: "DISABLED" });
		const denied = await f.resources.grant(f.owner, f.org, {
			resourceId: p.id,
			subject: { kind: "membership", id: f.membership },
			relation: "denied",
			operationKey: randomUUID(),
		});
		await f.resources.revokeGrant(f.owner, f.org, { grantId: denied.id });
		await f.resources.revokeGrant(f.owner, f.org, { grantId: viewer.id });
		const deleted = await f.resources.deleteProject(f.owner, f.org, {
			id: p.id,
			version: p.version,
			operationKey: randomUUID(),
		});
		await expect(
			f.resources.restoreProject(f.owner, f.org, {
				id: p.id,
				version: deleted.version,
				operationKey: randomUUID(),
			}),
		).rejects.toMatchObject({ code: "DISABLED" });
		await f.resources.setProjectPolicy(f.owner, f.org, {
			enabled: true,
			maxActive: 0,
		});
		await expect(
			f.resources.restoreProject(f.owner, f.org, {
				id: p.id,
				version: deleted.version,
				operationKey: randomUUID(),
			}),
		).rejects.toMatchObject({ code: "CAPACITY" });
	});
	it("creates a private project with immediately readable manager access, audit, and outbox", async () => {
		const f = await fixture();
		const project = await f.create(f.member);
		expect(
			(await f.resources.getProject(f.member, f.org, { id: project.id })).name,
		).toBe("Project");
		expect(
			(await f.resources.getProject(f.owner, f.org, { id: project.id })).id,
		).toBe(project.id);
		await expect(
			f.resources.getProject(f.outsider, f.org, { id: project.id }),
		).rejects.toThrow();
		const receipt = await f.app.query(
			"SELECT a.id FROM tenancy.audit_events a JOIN tenancy.outbox_events o ON o.id=a.id AND o.organization_id=a.organization_id WHERE a.organization_id=$1 AND a.target_id=$2",
			[f.org, project.id],
		);
		expect(receipt.rowCount).toBe(1);
		const revisions = await f.app.query(
			"SELECT desired_revision,applied_revision FROM tenancy.authorization_revisions WHERE organization_id=$1",
			[f.org],
		);
		expect(revisions.rows[0].desired_revision).toBe(
			revisions.rows[0].applied_revision,
		);
	});
	it("isolates tenant rows with RLS, missing context, and cross-tenant parents", async () => {
		const f = await fixture();
		const p = await f.create();
		expect((await f.web.query("SELECT id FROM tenancy.projects")).rows).toEqual(
			[],
		);
		const ws = await f.resources.createWorkspace(f.outsider, f.otherOrg, {
			name: "Other",
			slug: "other",
			operationKey: randomUUID(),
		});
		await expect(
			f.resources.moveProject(f.owner, f.org, {
				id: p.id,
				version: p.version,
				workspaceId: ws.id,
			}),
		).rejects.toThrow();
		await expect(
			f.resources.getProject(f.owner, f.otherOrg, { id: p.id }),
		).rejects.toThrow();
		const client = await f.web.connect();
		try {
			await client.query("BEGIN");
			await client.query("SELECT set_config('app.organization_id',$1,true)", [
				f.org,
			]);
			await expect(
				client.query(
					"UPDATE tenancy.projects SET workspace_id=$2 WHERE id=$1",
					[p.id, ws.id],
				),
			).rejects.toMatchObject({ code: "23503" });
		} finally {
			await client.query("ROLLBACK");
			client.release();
		}
		expect((await f.web.query("SELECT id FROM tenancy.projects")).rows).toEqual(
			[],
		);
	});
	it("checks viewer/editor/manager grants, revocation, and expired membership", async () => {
		const f = await fixture();
		const p = await f.create();
		await expect(
			f.resources.getProject(f.member, f.org, { id: p.id }),
		).rejects.toThrow();
		await f.resources.grant(f.owner, f.org, {
			resourceId: p.id,
			subject: { kind: "membership", id: f.membership },
			relation: "viewer",
			operationKey: randomUUID(),
		});
		expect(
			(await f.resources.getProject(f.member, f.org, { id: p.id })).id,
		).toBe(p.id);
		await expect(
			f.resources.updateProject(f.member, f.org, {
				id: p.id,
				version: p.version,
				name: "Forbidden",
			}),
		).rejects.toThrow();
		const grant = (
			await f.app.query(
				"SELECT id FROM tenancy.resource_grants WHERE organization_id=$1 AND resource_id=$2 AND membership_id=$3",
				[f.org, p.id, f.membership],
			)
		).rows[0];
		await f.resources.revokeGrant(f.owner, f.org, { grantId: grant.id });
		await expect(
			f.resources.getProject(f.member, f.org, { id: p.id }),
		).rejects.toThrow();
		await f.resources.grant(f.owner, f.org, {
			resourceId: p.id,
			subject: { kind: "membership", id: f.membership },
			relation: "editor",
			operationKey: randomUUID(),
		});
		const updated = await f.resources.updateProject(f.member, f.org, {
			id: p.id,
			version: p.version,
			name: "Editor allowed",
		});
		await expect(
			f.resources.deleteProject(f.member, f.org, {
				id: p.id,
				version: updated.version,
				operationKey: randomUUID(),
			}),
		).rejects.toThrow();
		await f.app.query(
			"UPDATE tenancy.memberships SET expires_at=clock_timestamp()-interval '1 second' WHERE id=$1",
			[f.membership],
		);
		await expect(
			f.resources.getProject(f.member, f.org, { id: p.id }),
		).rejects.toThrow();
	});
	it("inherits workspace access, rejects archived assignments, and permits managed moves out", async () => {
		const f = await fixture();
		const ws = await f.resources.createWorkspace(f.owner, f.org, {
			name: "Research",
			slug: "research",
			operationKey: randomUUID(),
		});
		await f.resources.grant(f.owner, f.org, {
			resourceId: ws.id,
			subject: { kind: "membership", id: f.membership },
			relation: "viewer",
			operationKey: randomUUID(),
		});
		const p = await f.resources.createProject(f.owner, f.org, {
			name: "Inherited",
			slug: "inherited",
			workspaceId: ws.id,
			operationKey: randomUUID(),
		});
		expect(
			(await f.resources.getProject(f.member, f.org, { id: p.id })).id,
		).toBe(p.id);
		await f.resources.updateWorkspace(f.owner, f.org, {
			id: ws.id,
			version: ws.version,
			archived: true,
		});
		expect(
			(await f.resources.getProject(f.member, f.org, { id: p.id })).id,
		).toBe(p.id);
		await expect(
			f.resources.createProject(f.owner, f.org, {
				name: "No",
				slug: "no",
				workspaceId: ws.id,
				operationKey: randomUUID(),
			}),
		).rejects.toThrow();
		await f.resources.moveProject(f.owner, f.org, {
			id: p.id,
			version: p.version,
			workspaceId: null,
		});
		await expect(
			f.resources.getProject(f.member, f.org, { id: p.id }),
		).rejects.toThrow();
	});
	it("requires source and destination authority for a parent move", async () => {
		const f = await fixture();
		const ws = await f.resources.createWorkspace(f.owner, f.org, {
			name: "Private",
			slug: "private",
			operationKey: randomUUID(),
		});
		const p = await f.create(f.member);
		await expect(
			f.resources.moveProject(f.member, f.org, {
				id: p.id,
				version: p.version,
				workspaceId: ws.id,
			}),
		).rejects.toThrow();
		await f.resources.grant(f.owner, f.org, {
			resourceId: ws.id,
			subject: { kind: "membership", id: f.membership },
			relation: "manager",
			operationKey: randomUUID(),
		});
		const moved = await f.resources.moveProject(f.member, f.org, {
			id: p.id,
			version: p.version,
			workspaceId: ws.id,
		});
		expect(moved.workspaceId).toBe(ws.id);
	});
	it("propagates team revocation and team removal without retaining resource access", async () => {
		const f = await fixture();
		const p = await f.create();
		const team = await f.tenancy.createTeam(f.owner, f.org, {
			name: "Team",
			slug: "team",
		});
		await f.tenancy.setTeamMember(f.owner, f.org, {
			teamId: team.id,
			membershipId: f.membership,
			present: true,
		});
		await f.resources.grant(f.owner, f.org, {
			resourceId: p.id,
			subject: { kind: "team", id: team.id },
			relation: "viewer",
			operationKey: randomUUID(),
		});
		expect(
			(await f.resources.getProject(f.member, f.org, { id: p.id })).id,
		).toBe(p.id);
		await f.tenancy.setTeamMember(f.owner, f.org, {
			teamId: team.id,
			membershipId: f.membership,
			present: false,
		});
		await expect(
			f.resources.getProject(f.member, f.org, { id: p.id }),
		).rejects.toThrow();
		await f.tenancy.removeTeam(f.owner, f.org, team.id);
	});
	it("rejects stale edits and atomically admits only one winner at the final capacity slot", async () => {
		const f = await fixture(1);
		const results = await Promise.allSettled([f.create(), f.create()]);
		expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
		const success = results.find((r) => r.status === "fulfilled");
		if (success?.status !== "fulfilled") throw new Error("Missing success");
		const p = success.value;
		const updates = await Promise.allSettled(
			["A", "B"].map((name) =>
				f.resources.updateProject(f.owner, f.org, {
					id: p.id,
					version: p.version,
					name,
				}),
			),
		);
		expect(updates.filter((r) => r.status === "fulfilled")).toHaveLength(1);
	});
	it("rechecks capacity during restore and does not double-spend on idempotent retry", async () => {
		const f = await fixture(1);
		const command = {
			name: "Retry",
			slug: "retry",
			operationKey: randomUUID(),
		};
		const p = await f.resources.createProject(f.owner, f.org, command);
		expect((await f.resources.createProject(f.owner, f.org, command)).id).toBe(
			p.id,
		);
		await expect(
			f.resources.createProject(f.owner, f.org, {
				...command,
				name: "Different",
			}),
		).rejects.toThrow();
		const deleted = await f.resources.deleteProject(f.owner, f.org, {
			id: p.id,
			version: p.version,
			operationKey: randomUUID(),
		});
		const replacement = await f.create();
		await expect(
			f.resources.restoreProject(f.owner, f.org, {
				id: p.id,
				version: deleted.version,
				operationKey: randomUUID(),
			}),
		).rejects.toThrow();
		await f.resources.deleteProject(f.owner, f.org, {
			id: replacement.id,
			version: replacement.version,
			operationKey: randomUUID(),
		});
		const restore = {
			id: p.id,
			version: deleted.version,
			operationKey: randomUUID(),
		};
		expect((await f.resources.restoreProject(f.owner, f.org, restore)).id).toBe(
			p.id,
		);
		expect((await f.resources.restoreProject(f.owner, f.org, restore)).id).toBe(
			p.id,
		);
	});
	it("rechecks current resource access before returning a stored create result", async () => {
		const f = await fixture();
		const command = {
			name: "Replay",
			slug: "replay",
			operationKey: randomUUID(),
		};
		const p = await f.resources.createProject(f.member, f.org, command);
		const grant = (
			await f.app.query(
				"SELECT id FROM tenancy.resource_grants WHERE organization_id=$1 AND resource_id=$2 AND membership_id=$3",
				[f.org, p.id, f.membership],
			)
		).rows[0];
		await f.resources.revokeGrant(f.owner, f.org, { grantId: grant.id });
		await expect(
			f.resources.createProject(f.member, f.org, command),
		).rejects.toThrow();
	});
	it("returns only authorized search fields and continues sparse keyset pages without totals", async () => {
		const f = await fixture();
		for (let i = 0; i < 12; i++) await f.create(f.owner, `Secret ${i}`);
		const allowed = await f.create(f.member, "Needle");
		const page = await f.resources.listProjects(f.member, f.org, {
			limit: 2,
			search: "Needle",
		});
		expect(page.items.map((p) => p.id)).toEqual([allowed.id]);
		expect(page).not.toHaveProperty("total");
		expect(
			await f.resources.listProjects(f.member, f.org, { search: "Secret" }),
		).toMatchObject({ items: [] });
		let cursor: string | undefined;
		const ids: string[] = [];
		do {
			const next = await f.resources.listProjects(f.owner, f.org, {
				limit: 3,
				cursor,
			});
			ids.push(...next.items.map((p) => p.id));
			cursor = next.nextCursor ?? undefined;
		} while (cursor);
		expect(new Set(ids).size).toBe(13);
		expect(ids).toHaveLength(13);
	});
	it("applies direct and inherited denials and restores only the remaining current grant paths", async () => {
		const f = await fixture();
		const ws = await f.resources.createWorkspace(f.owner, f.org, {
			name: "Shared",
			slug: "shared",
			operationKey: randomUUID(),
		});
		const grant = (resourceId: string, relation: "viewer" | "denied") =>
			f.resources.grant(f.owner, f.org, {
				resourceId,
				subject: { kind: "membership", id: f.membership },
				relation,
				operationKey: randomUUID(),
			});
		const inherited = await grant(ws.id, "viewer");
		const p = await f.resources.createProject(f.owner, f.org, {
			name: "Inherited",
			slug: "denials",
			workspaceId: ws.id,
			operationKey: randomUUID(),
		});
		const denyParent = await grant(ws.id, "denied");
		await expect(
			f.resources.getProject(f.member, f.org, { id: p.id }),
		).rejects.toThrow();
		expect((await f.resources.listProjects(f.member, f.org)).items).toEqual([]);
		await f.resources.revokeGrant(f.owner, f.org, { grantId: denyParent.id });
		expect(
			(await f.resources.getProject(f.member, f.org, { id: p.id })).id,
		).toBe(p.id);
		const denyProject = await grant(p.id, "denied");
		await expect(
			f.resources.getProject(f.member, f.org, { id: p.id }),
		).rejects.toThrow();
		await f.resources.revokeGrant(f.owner, f.org, { grantId: denyProject.id });
		await f.resources.revokeGrant(f.owner, f.org, { grantId: inherited.id });
		await expect(
			f.resources.getProject(f.member, f.org, { id: p.id }),
		).rejects.toThrow();
	});
	it("renames and paginates only authorized workspaces with optimistic versions", async () => {
		const f = await fixture();
		const visible = await f.resources.createWorkspace(f.member, f.org, {
			name: "Before",
			slug: "visible",
			operationKey: randomUUID(),
		});
		await f.resources.createWorkspace(f.owner, f.org, {
			name: "Private",
			slug: "private",
			operationKey: randomUUID(),
		});
		const renamed = await f.resources.updateWorkspace(f.member, f.org, {
			id: visible.id,
			version: visible.version,
			name: "After",
		});
		await expect(
			f.resources.updateWorkspace(f.member, f.org, {
				id: visible.id,
				version: visible.version,
				name: "Stale",
			}),
		).rejects.toThrow();
		expect(
			(
				await f.resources.listWorkspaces(f.member, f.org, { limit: 2 })
			).items.map((x) => ({ id: x.id, name: x.name })),
		).toEqual([{ id: visible.id, name: "After" }]);
		const archived = await f.resources.updateWorkspace(f.member, f.org, {
			id: visible.id,
			version: renamed.version,
			archived: true,
		});
		expect(
			(await f.resources.listWorkspaces(f.member, f.org)).items[0]?.archivedAt,
		).toBe(archived.archivedAt);
	});
	it("serializes create against restore at the final quota slot and rolls back the losing command", async () => {
		const f = await fixture(1);
		const old = await f.create();
		const deleted = await f.resources.deleteProject(f.owner, f.org, {
			id: old.id,
			version: old.version,
			operationKey: randomUUID(),
		});
		const results = await Promise.allSettled([
			f.create(),
			f.resources.restoreProject(f.owner, f.org, {
				id: old.id,
				version: deleted.version,
				operationKey: randomUUID(),
			}),
		]);
		expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
		expect(
			(
				await f.app.query(
					"SELECT consumed,reserved FROM tenancy.capacity_buckets WHERE organization_id=$1 AND feature='projects.max_active'",
					[f.org],
				)
			).rows[0],
		).toEqual({ consumed: 1, reserved: 0 });
		expect(
			(
				await f.app.query(
					"SELECT count(*)::integer AS count FROM tenancy.projects WHERE organization_id=$1 AND deleted_at IS NULL",
					[f.org],
				)
			).rows[0].count,
		).toBe(1);
		expect(
			(
				await f.app.query(
					"SELECT count(*)::integer AS count FROM tenancy.audit_events WHERE organization_id=$1 AND action IN ('project.created','project.restored')",
					[f.org],
				)
			).rows[0].count,
		).toBe(2);
	});
	it("keeps cursor precision and binds opaque cursors to their actor and query", async () => {
		const f = await fixture();
		const ids: string[] = [];
		for (let i = 0; i < 3; i++)
			ids.push((await f.create(f.owner, `Same instant ${i}`)).id);
		await f.app.query(
			"UPDATE tenancy.projects SET created_at='2026-09-26T12:00:00.123456Z' WHERE organization_id=$1",
			[f.org],
		);
		const first = await f.resources.listProjects(f.owner, f.org, { limit: 1 });
		expect(first.nextCursor).toBeTruthy();
		const cursor = first.nextCursor as string;
		await expect(
			f.resources.listProjects(f.member, f.org, { limit: 1, cursor }),
		).rejects.toThrow();
		await expect(
			f.resources.listProjects(f.owner, f.org, {
				limit: 1,
				cursor,
				search: "different",
			}),
		).rejects.toThrow();
		await expect(
			f.resources.listProjects(f.owner, f.org, {
				limit: 1,
				cursor: `x${cursor}`,
			}),
		).rejects.toThrow();
		const found = first.items.map((x) => x.id);
		let next: string | null = cursor;
		while (next) {
			const page = await f.resources.listProjects(f.owner, f.org, {
				limit: 1,
				cursor: next,
			});
			found.push(...page.items.map((x) => x.id));
			next = page.nextCursor;
		}
		expect(found.sort()).toEqual(ids.sort());
	});
	it.each(["batch", "single"] as const)(
		"denies an earlier authorized row that expires during a later %s check",
		async (mode) => {
			const f = await fixture();
			const projects = [];
			for (let i = 0; i < 11; i++)
				projects.push(await f.create(f.owner, `Expiration ${i}`));
			const newest = projects.at(-1);
			if (!newest) throw new Error("Missing project");
			const expiresAt = new Date(Date.now() + 1500);
			await f.resources.grant(f.owner, f.org, {
				resourceId: newest.id,
				subject: { kind: "membership", id: f.membership },
				relation: "viewer",
				expiresAt,
				operationKey: randomUUID(),
			});
			let calls = 0,
				observedAllow = false;
			const delayUntilExpired = async (
				client: Parameters<typeof f.authorization.checkResource>[0],
			) => {
				await client.query(
					"SELECT pg_sleep(greatest(0,extract(epoch FROM ($1::timestamptz-clock_timestamp())))+0.02)",
					[expiresAt],
				);
			};
			const guarded = createResourceService(f.web, {
				authorize: f.authorization.authorizeResource,
				sourceCommit: f.authorization.sourceCommit,
				check: async (...args) => {
					const allowed = await f.authorization.checkResource(...args);
					if (args[3].id === newest.id) observedAllow = allowed;
					if (mode === "single" && ++calls === 11)
						await delayUntilExpired(args[0]);
					return allowed;
				},
				...(mode === "batch"
					? {
							checkBatch: async (
								...args: Parameters<typeof f.authorization.checkResourceBatch>
							) => {
								const allowed = await f.authorization.checkResourceBatch(
									...args,
								);
								if (calls === 0) observedAllow = allowed.some(Boolean);
								if (++calls === 2) await delayUntilExpired(args[0]);
								return allowed;
							},
						}
					: {}),
			});
			await expect(
				guarded.listProjects(f.member, f.org, { limit: 2 }),
			).rejects.toMatchObject({ code: "DENIED" });
			expect(observedAllow).toBe(true);
			expect(calls).toBe(mode === "batch" ? 2 : 11);
			// Transaction-local deadlines cannot poison a subsequent request on this pool.
			expect(
				(await f.resources.getProject(f.owner, f.org, { id: newest.id })).id,
			).toBe(newest.id);
		},
	);
	it("fails closed when a populated workspace module is disabled", async () => {
		const f = await fixture();
		await f.resources.createWorkspace(f.owner, f.org, {
			name: "Enabled",
			slug: "enabled",
			operationKey: randomUUID(),
		});
		const disabled = createResourceService(
			f.web,
			{
				authorize: f.authorization.authorizeResource,
				check: f.authorization.checkResource,
				sourceCommit: f.authorization.sourceCommit,
			},
			{ workspacesEnabled: false },
		);
		await expect(disabled.listWorkspaces(f.owner, f.org, {})).rejects.toThrow();
		await expect(
			disabled.createWorkspace(f.owner, f.org, {
				name: "No",
				slug: "no",
				operationKey: randomUUID(),
			}),
		).rejects.toThrow();
	});
});

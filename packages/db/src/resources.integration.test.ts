import { createHash, randomUUID } from "node:crypto";
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
	it("isolates tenant rows with RLS, missing context, and cross-tenant ownership", async () => {
		const f = await fixture();
		const p = await f.create();
		expect((await f.web.query("SELECT id FROM tenancy.projects")).rows).toEqual(
			[],
		);
		const otherMembership = (
			await f.app.query<{ id: string }>(
				"SELECT id FROM tenancy.memberships WHERE organization_id=$1 AND user_id=$2",
				[f.otherOrg, f.outsider.userId],
			)
		).rows[0]?.id;
		expect(otherMembership).toBeTruthy();
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
					"UPDATE tenancy.projects SET owner_membership_id=$2 WHERE id=$1",
					[p.id, otherMembership],
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
	it("rejects removed assignment and filter fields before writing or reading Projects", async () => {
		const f = await fixture();
		const p = await f.create();
		const workspaceId = randomUUID();
		await expect(
			f.resources.createProject(f.owner, f.org, {
				name: "Removed assignment",
				slug: "removed-assignment",
				operationKey: randomUUID(),
				...{ workspaceId },
			}),
		).rejects.toMatchObject({ code: "INVALID" });
		await expect(
			f.resources.updateProject(f.owner, f.org, {
				id: p.id,
				version: p.version,
				name: "Must not update",
				...{ workspaceId: null },
			}),
		).rejects.toMatchObject({ code: "INVALID" });
		await expect(
			f.resources.listProjects(f.owner, f.org, {
				limit: 10,
				...{ workspaceId },
			}),
		).rejects.toMatchObject({ code: "INVALID" });
		expect(
			await f.resources.getProject(f.owner, f.org, { id: p.id }),
		).toMatchObject({ name: p.name, version: p.version });
		expect(p).not.toHaveProperty("workspaceId");
		expect(f.resources).not.toHaveProperty("moveProject");
		expect(f.resources).not.toHaveProperty("listWorkspaces");
		expect(f.resources).not.toHaveProperty("createWorkspace");
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
	it("conflicts with pre-retirement create hashes without duplicating an unassigned Project", async () => {
		const f = await fixture();
		const command = {
			name: "Historical receipt",
			slug: "historical-receipt",
			operationKey: randomUUID(),
		};
		const project = await f.resources.createProject(f.member, f.org, command);
		const oldHash = createHash("sha256")
			.update(
				JSON.stringify({
					name: command.name,
					slug: command.slug,
					description: "",
					ownerMembershipId: "creator",
					workspaceId: null,
				}),
			)
			.digest("hex");
		await f.app.query(
			"UPDATE tenancy.resource_operations SET input_hash=$3 WHERE organization_id=$1 AND operation='project.create' AND operation_key=$2",
			[f.org, command.operationKey, oldHash],
		);
		await expect(
			f.resources.createProject(f.member, f.org, command),
		).rejects.toMatchObject({ code: "CONFLICT" });
		expect(
			(await f.resources.listProjects(f.member, f.org)).items.map(
				(row) => row.id,
			),
		).toEqual([project.id]);
		expect(
			(
				await f.app.query(
					"SELECT input_hash FROM tenancy.resource_operations WHERE organization_id=$1 AND operation='project.create' AND operation_key=$2",
					[f.org, command.operationKey],
				)
			).rows[0],
		).toEqual({ input_hash: oldHash });
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
	it("applies Project denials over direct and team grants while retaining organization administration", async () => {
		const f = await fixture();
		const p = await f.create();
		const team = await f.tenancy.createTeam(f.owner, f.org, {
			name: "Shared",
			slug: "shared",
		});
		await f.tenancy.setTeamMember(f.owner, f.org, {
			teamId: team.id,
			membershipId: f.membership,
			present: true,
		});
		const teamGrant = await f.resources.grant(f.owner, f.org, {
			resourceId: p.id,
			subject: { kind: "team", id: team.id },
			relation: "viewer",
			operationKey: randomUUID(),
		});
		const direct = await f.resources.grant(f.owner, f.org, {
			resourceId: p.id,
			subject: { kind: "membership", id: f.membership },
			relation: "editor",
			operationKey: randomUUID(),
		});
		const denied = await f.resources.grant(f.owner, f.org, {
			resourceId: p.id,
			subject: { kind: "membership", id: f.membership },
			relation: "denied",
			operationKey: randomUUID(),
		});
		await expect(
			f.resources.getProject(f.member, f.org, { id: p.id }),
		).rejects.toThrow();
		expect((await f.resources.listProjects(f.member, f.org)).items).toEqual([]);
		expect(
			(await f.resources.getProject(f.owner, f.org, { id: p.id })).id,
		).toBe(p.id);
		await f.resources.revokeGrant(f.owner, f.org, { grantId: denied.id });
		expect(
			(await f.resources.getProject(f.member, f.org, { id: p.id })).id,
		).toBe(p.id);
		await f.resources.revokeGrant(f.owner, f.org, { grantId: direct.id });
		expect(
			(await f.resources.getProject(f.member, f.org, { id: p.id })).id,
		).toBe(p.id);
		await f.resources.revokeGrant(f.owner, f.org, { grantId: teamGrant.id });
		await expect(
			f.resources.getProject(f.member, f.org, { id: p.id }),
		).rejects.toThrow();
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
});

import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { afterEach, describe, expect, it } from "vitest";
import { bootstrap } from "../../authz/src/commands";
import { createAuthorizationService } from "../../authz/src/index";
import { dropTestDatabase } from "../../testing/src/database";
import { runMigrations } from "./migrate";
import {
	type ControlPrincipal,
	createTenancyService,
	type TenancyHooks,
	type TenantActor,
	withTenantTransaction,
} from "./tenancy";

const adminUrl =
	process.env.TEST_DATABASE_ADMIN_URL ??
	"postgres://postgres:local_phase1@127.0.0.1:55433/postgres";
const controlAdminUrl =
	process.env.TEST_CONTROL_ADMIN_URL ??
	"postgres://postgres:local_phase2_control@127.0.0.1:55434/postgres";
const fgaUrl = process.env.OPENFGA_API_URL ?? "http://127.0.0.1:18081";
const cleanup: Array<() => Promise<void>> = [];
afterEach(async () => {
	for (const action of cleanup.splice(0).reverse()) await action();
});
async function fixture(capacity = 5) {
	const admin = new Pool({ connectionString: adminUrl }),
		controlAdmin = new Pool({ connectionString: controlAdminUrl });
	const name = `phase2_tenant_${randomUUID().replaceAll("-", "")}`;
	await admin.query(`CREATE DATABASE ${name} OWNER common_saas_migrator`);
	await controlAdmin.query(
		`CREATE DATABASE ${name} OWNER common_saas_control_admin`,
	);
	cleanup.push(async () => {
		await dropTestDatabase(admin, name);
		await dropTestDatabase(controlAdmin, name);
		await admin.end();
		await controlAdmin.end();
	});
	function url(base: string, role: string, password: string) {
		const u = new URL(base);
		u.pathname = `/${name}`;
		u.username = role;
		u.password = password;
		return u.toString();
	}
	const migrateUrl = url(adminUrl, "common_saas_migrator", "local_phase1");
	await runMigrations({ databaseUrl: migrateUrl });
	const app = new Pool({ connectionString: migrateUrl }),
		web = new Pool({
			connectionString: url(adminUrl, "common_saas_web", "local_phase1"),
			max: 8,
		}),
		worker = new Pool({
			connectionString: url(adminUrl, "common_saas_worker", "local_phase1"),
		});
	const control = new Pool({
			connectionString: url(
				controlAdminUrl,
				"common_saas_control_admin",
				"local_phase2_control",
			),
		}),
		reader = new Pool({
			connectionString: url(
				controlAdminUrl,
				"common_saas_control_reader",
				"local_phase2_control",
			),
		});
	let closing = false;
	for (const connectionPool of [app, web, worker, control, reader])
		connectionPool.on("error", (error) => {
			if (!closing) throw error;
		});
	cleanup.push(async () => {
		closing = true;
		await Promise.all([
			app.end(),
			web.end(),
			worker.end(),
			control.end(),
			reader.end(),
		]);
	});
	const installationId = randomUUID();
	await bootstrap({
		applicationPool: app,
		controlPool: control,
		installationId,
		openfgaUrl: fgaUrl,
	});
	cleanup.push(async () => {
		const row = (
			await control.query(
				"SELECT store_id FROM control.installations WHERE installation_id=$1",
				[installationId],
			)
		).rows[0];
		if (row)
			await fetch(`${fgaUrl}/stores/${row.store_id}`, { method: "DELETE" });
	});
	const notices: Parameters<TenancyHooks["notify"]>[1][] = [];
	const authz = createAuthorizationService({
		controlPool: reader,
		installationId,
		openfgaUrl: fgaUrl,
	});
	const notify: TenancyHooks["notify"] = async (_client, notice) => {
		notices.push(notice);
	};
	const service = createTenancyService(
		web,
		{ ...authz, notify },
		{ defaultSeatCapacity: capacity },
	);
	async function user(): Promise<TenantActor> {
		const userId = randomUUID();
		await app.query(
			'INSERT INTO identity."user"(id,name,email,email_verified) VALUES ($1,$1,$2,true)',
			[userId, `${userId}@example.test`],
		);
		return { userId, authenticatedAt: new Date(), mfa: true, method: "totp" };
	}
	const owner = await user();
	const org = await service.createOrganization(owner, {
		slug: `org-${randomUUID().slice(0, 8)}`,
		name: "Organization",
		operationKey: randomUUID(),
	});
	async function invite(
		actor: TenantActor,
		role: "admin" | "member" | "billing" = "member",
	) {
		const invitation = await service.invite(owner, org.id, {
			email: `${actor.userId}@example.test`,
			role,
			operationKey: randomUUID(),
		});
		const token = notices.find(
			(notice) => notice.referenceId === invitation.id,
		)?.token;
		if (!token) throw new Error("No invitation email");
		return { ...invitation, token };
	}
	async function admit(
		actor: TenantActor,
		role: "admin" | "member" | "billing" = "member",
	) {
		const invitation = await invite(actor, role);
		await service.acceptInvitation(actor, org.id, {
			token: invitation.token,
			operationKey: randomUUID(),
		});
		return (
			(await service.readOrganization(owner, org.id)).members.find(
				(member) => member.userId === actor.userId,
			)?.id ?? "missing"
		);
	}
	function principal(
		scope: ControlPrincipal["scope"],
		orgId = org.id,
	): ControlPrincipal {
		return {
			operatorId: "verified-operator",
			organizationId: orgId,
			scope,
			expiresAt: new Date(Date.now() + 60_000),
			mfaAt: new Date(),
			evidenceReference: "independent:case:12345",
		};
	}
	return {
		app,
		web,
		worker,
		control,
		reader,
		installationId,
		authz,
		notify,
		service,
		notices,
		user,
		owner,
		org,
		invite,
		admit,
		principal,
	};
}

describe("production tenancy, lifecycle fences and local seats with PostgreSQL/OpenFGA", () => {
	it("isolates real restricted roles, pooled context, multi-organization users and composite team references", async () => {
		const f = await fixture(),
			other = await f.service.createOrganization(f.owner, {
				slug: "second-organization",
				name: "Second",
				operationKey: "second",
			});
		expect(
			(await f.service.listOrganizations(f.owner)).map((org) => org.id).sort(),
		).toEqual([f.org.id, other.id].sort());
		expect(
			(await f.web.query("SELECT id FROM tenancy.memberships")).rows,
		).toEqual([]);
		for (const pool of [f.web, f.worker]) {
			const first = await withTenantTransaction(
				pool,
				f.org.id,
				[f.owner.userId],
				false,
				async (client) =>
					(
						await client.query(
							"SELECT organization_id FROM tenancy.memberships",
						)
					).rows,
			);
			expect(first).toEqual([{ organization_id: f.org.id }]);
			const second = await withTenantTransaction(
				pool,
				other.id,
				[f.owner.userId],
				false,
				async (client) =>
					(
						await client.query(
							"SELECT organization_id FROM tenancy.memberships",
						)
					).rows,
			);
			expect(second).toEqual([{ organization_id: other.id }]);
			expect(
				(await pool.query("SELECT id FROM tenancy.memberships")).rowCount,
			).toBe(0);
			await expect(
				pool.query("TRUNCATE tenancy.memberships"),
			).rejects.toMatchObject({ code: "42501" });
			await expect(
				pool.query(
					"ALTER TABLE tenancy.memberships DISABLE ROW LEVEL SECURITY",
				),
			).rejects.toMatchObject({ code: "42501" });
		}
		expect(
			(await f.web.query("SELECT id FROM tenancy.organizations")).rows,
		).toEqual([]);
		const one = await f.service.readOrganization(f.owner, f.org.id),
			two = await f.service.readOrganization(f.owner, other.id);
		await expect(
			withTenantTransaction(f.web, f.org.id, [f.owner.userId], true, (client) =>
				client.query(
					"INSERT INTO tenancy.memberships(id,organization_id,user_id,role,status,billable) VALUES ($1,$2,$3,'member','active',true)",
					[randomUUID(), f.org.id, f.owner.userId],
				),
			),
		).rejects.toMatchObject({ code: "23505" });
		const team = await f.service.createTeam(f.owner, f.org.id, {
			name: "Core",
			slug: "core",
		});
		await expect(
			withTenantTransaction(f.web, f.org.id, [f.owner.userId], true, (client) =>
				client.query(
					"INSERT INTO tenancy.team_members(organization_id,team_id,membership_id) VALUES ($1,$2,$3)",
					[f.org.id, team.id, two.membership.id],
				),
			),
		).rejects.toMatchObject({ code: "23503" });
		await expect(
			withTenantTransaction(f.web, f.org.id, [f.owner.userId], true, (client) =>
				client.query(
					"INSERT INTO tenancy.team_members(organization_id,team_id,membership_id) VALUES ($1,$2,$3)",
					[other.id, team.id, one.membership.id],
				),
			),
		).rejects.toMatchObject({ code: "42501" });
		const auditId = randomUUID();
		await f.app.query(
			"INSERT INTO tenancy.audit_events(id,organization_id,actor_id,action,target_id,changes) VALUES ($1,$2,$3,'test.boundary','test-target','{}')",
			[auditId, other.id, f.owner.userId],
		);
		await expect(
			withTenantTransaction(f.web, f.org.id, [f.owner.userId], true, (client) =>
				client.query(
					"INSERT INTO tenancy.outbox_events(id,organization_id,type,payload) VALUES ($1,$2,'test.boundary','{}')",
					[auditId, f.org.id],
				),
			),
		).rejects.toMatchObject({ code: "23503" });
	});
	it("accepts verified same-account invitations atomically once, rejects expiry/cancel and rolls back email failures", async () => {
		const f = await fixture(),
			member = await f.user(),
			stranger = await f.user(),
			invite = await f.invite(member);
		await expect(
			f.service.acceptInvitation(stranger, f.org.id, {
				token: invite.token,
				operationKey: randomUUID(),
			}),
		).rejects.toMatchObject({ code: "DENIED" });
		const accepts = await Promise.all(
			[1, 2].map(() =>
				f.service.acceptInvitation(member, f.org.id, {
					token: invite.token,
					operationKey: randomUUID(),
				}),
			),
		);
		expect(accepts).toEqual([{ id: invite.id }, { id: invite.id }]);
		expect(
			(await f.service.readOrganization(f.owner, f.org.id)).seats.occupied,
		).toBe(2);
		const expired = await f.invite(stranger);
		await f.app.query(
			"UPDATE tenancy.invitations SET expires_at=now()-interval '1 second' WHERE id=$1",
			[expired.id],
		);
		await expect(
			f.service.acceptInvitation(stranger, f.org.id, {
				token: expired.token,
				operationKey: randomUUID(),
			}),
		).rejects.toMatchObject({ code: "EXPIRED" });
		const canceled = await f.invite(stranger);
		await f.service.cancelInvitation(f.owner, f.org.id, canceled.id);
		await expect(
			f.service.acceptInvitation(stranger, f.org.id, {
				token: canceled.token,
				operationKey: randomUUID(),
			}),
		).rejects.toMatchObject({ code: "EXPIRED" });
		const broken = createTenancyService(f.web, {
			...f.authz,
			notify: async () => {
				throw new Error("mail queue unavailable");
			},
		});
		await expect(
			broken.invite(f.owner, f.org.id, {
				email: "failure@example.test",
				role: "member",
				operationKey: "email-failure",
			}),
		).rejects.toThrow("mail queue unavailable");
		expect(
			(
				await f.app.query(
					"SELECT id FROM tenancy.invitations WHERE email='failure@example.test'",
				)
			).rowCount,
		).toBe(0);
		expect(
			(
				await f.app.query(
					"SELECT token_hash FROM tenancy.invitations WHERE id=$1",
					[invite.id],
				)
			).rows[0].token_hash,
		).not.toBe(invite.token);
	});
	it("enforces one last seat across invitation versus reactivation and keeps idempotent release receipts", async () => {
		const f = await fixture(2),
			member = await f.user(),
			candidate = await f.user();
		const membershipId = await f.admit(member);
		await f.service.transitionMembership(f.owner, f.org.id, {
			membershipId,
			status: "inactive",
			role: "member",
			billable: true,
			operationKey: "off",
		});
		const invitation = await f.invite(candidate);
		const outcomes = await Promise.allSettled([
			f.service.acceptInvitation(candidate, f.org.id, {
				token: invitation.token,
				operationKey: "join",
			}),
			f.service.transitionMembership(f.owner, f.org.id, {
				membershipId,
				status: "active",
				role: "member",
				billable: true,
				operationKey: "reactivate",
			}),
		]);
		expect(
			outcomes.filter((result) => result.status === "fulfilled"),
		).toHaveLength(1);
		expect(
			outcomes.filter((result) => result.status === "rejected"),
		).toMatchObject([{ reason: { code: "CAPACITY" } }]);
		const snapshot = await f.service.readOrganization(f.owner, f.org.id);
		expect(snapshot.seats).toEqual({ capacity: 2, occupied: 2 });
		await expect(
			f.service.transitionMembership(f.owner, f.org.id, {
				membershipId: snapshot.membership.id,
				status: "active",
				role: "owner",
				billable: false,
				operationKey: "bypass",
			}),
		).rejects.toMatchObject({ code: "INVALID" });
		await expect(
			f.service.setLocalCapacity(f.owner, f.org.id, 1),
		).rejects.toMatchObject({ code: "CAPACITY" });
		const active = snapshot.members.find(
			(row) => row.userId !== f.owner.userId && row.status === "active",
		);
		if (!active) throw new Error("Missing winning member");
		await Promise.all(
			[1, 2].map(() =>
				f.service.transitionMembership(f.owner, f.org.id, {
					membershipId: active.id,
					status: "inactive",
					role: "member",
					billable: true,
					operationKey: "same-release",
				}),
			),
		);
		expect(
			(await f.service.readOrganization(f.owner, f.org.id)).seats.occupied,
		).toBe(1);
		expect(
			(
				await f.app.query(
					"SELECT delta FROM tenancy.membership_transitions WHERE operation_key='same-release'",
				)
			).rows,
		).toEqual([{ delta: -1 }]);
	});
	it("serializes billable classification races and retains active owners", async () => {
		const f = await fixture(2),
			first = await f.user(),
			second = await f.user();
		const ids = await Promise.all([
			f.admit(first, "billing"),
			f.admit(second, "billing"),
		]);
		const changes = await Promise.allSettled(
			ids.map((membershipId) =>
				f.service.transitionMembership(f.owner, f.org.id, {
					membershipId,
					status: "active",
					role: "member",
					billable: true,
					operationKey: randomUUID(),
				}),
			),
		);
		expect(
			changes.filter((result) => result.status === "fulfilled"),
		).toHaveLength(1);
		expect(
			(await f.service.readOrganization(f.owner, f.org.id)).seats.occupied,
		).toBe(2);
		const ownerId = (await f.service.readOrganization(f.owner, f.org.id))
			.membership.id;
		await expect(
			f.service.transitionMembership(f.owner, f.org.id, {
				membershipId: ownerId,
				status: "inactive",
				role: "owner",
				billable: true,
				operationKey: "last",
			}),
		).rejects.toMatchObject({ code: "LAST_OWNER" });
	});
	it.each(["admin", "member", "billing", "inactive"] as const)(
		"completes transfer with outgoing %s access, seats, source publication and replay",
		async (outgoingRole) => {
			const f = await fixture(2),
				recipient = await f.user(),
				recipientId = await f.admit(recipient, "billing");
			const transfer = await f.service.startTransfer(f.owner, f.org.id, {
				recipientMembershipId: recipientId,
				outgoingRole,
			});
			await expect(
				f.service.acceptTransfer(f.owner, f.org.id, {
					transferId: transfer.id,
					operationKey: "transfer",
				}),
			).rejects.toMatchObject({ code: "DENIED" });
			await f.service.acceptTransfer(recipient, f.org.id, {
				transferId: transfer.id,
				operationKey: "transfer",
			});
			await expect(
				f.service.acceptTransfer(recipient, f.org.id, {
					transferId: transfer.id,
					operationKey: "transfer",
				}),
			).resolves.toEqual({ id: transfer.id });
			const result = await f.service.readOrganization(recipient, f.org.id);
			expect(result.membership.role).toBe("owner");
			expect(result.seats.occupied).toBe(
				outgoingRole === "inactive" || outgoingRole === "billing" ? 1 : 2,
			);
			expect(
				result.members.find((row) => row.userId === f.owner.userId),
			).toMatchObject({
				role: outgoingRole === "inactive" ? "member" : outgoingRole,
				status: outgoingRole === "inactive" ? "inactive" : "active",
			});
			expect(
				result.transfers.find((item) => item.id === transfer.id),
			).toMatchObject({ outgoingRole, status: "accepted" });
			if (outgoingRole === "inactive")
				await expect(
					f.service.readSummary(f.owner, f.org.id),
				).rejects.toThrow();
			else
				await expect(
					f.service.readSummary(f.owner, f.org.id),
				).resolves.toMatchObject({ membership: { role: outgoingRole } });
			if (outgoingRole === "admin")
				await expect(
					f.service.readOrganization(f.owner, f.org.id),
				).resolves.toMatchObject({ membership: { role: "admin" } });
			else
				await expect(
					f.service.readOrganization(f.owner, f.org.id),
				).rejects.toThrow();
			await expect(
				f.service.startTransfer(f.owner, f.org.id, {
					recipientMembershipId: recipientId,
					outgoingRole: "member",
				}),
			).rejects.toThrow();
			expect(
				(
					await f.app.query(
						"SELECT desired_revision=applied_revision AS ready FROM tenancy.authorization_revisions WHERE organization_id=$1",
						[f.org.id],
					)
				).rows[0].ready,
			).toBe(true);
			const audit = await f.app.query(
				"SELECT action FROM tenancy.audit_events WHERE organization_id=$1 AND action='ownership.transferred'",
				[f.org.id],
			);
			expect(audit.rowCount).toBe(1);
			const completed = f.notices.filter(
				(notice) => notice.kind === "transfer-completed",
			);
			expect(completed.map((notice) => notice.email).sort()).toEqual(
				[
					`${f.owner.userId}@example.test`,
					`${recipient.userId}@example.test`,
				].sort(),
			);
			expect(completed.map((notice) => notice.transfer)).toEqual(
				Array(2).fill({
					fromEmail: `${f.owner.userId}@example.test`,
					toEmail: `${recipient.userId}@example.test`,
				}),
			);
		},
	);
	it("refuses stale, expired, canceled and cross-tenant transfer attempts", async () => {
		const f = await fixture(),
			recipient = await f.user(),
			recipientId = await f.admit(recipient);
		await expect(
			f.service.startTransfer(
				{ ...f.owner, authenticatedAt: new Date(0) },
				f.org.id,
				{ recipientMembershipId: recipientId, outgoingRole: "member" },
			),
		).rejects.toMatchObject({ code: "DENIED" });
		const expired = await f.service.startTransfer(f.owner, f.org.id, {
			recipientMembershipId: recipientId,
			outgoingRole: "member",
		});
		await f.app.query(
			"UPDATE tenancy.ownership_transfers SET expires_at=now()-interval '1 second' WHERE id=$1",
			[expired.id],
		);
		await expect(
			f.service.acceptTransfer(recipient, f.org.id, {
				transferId: expired.id,
				operationKey: "expired",
			}),
		).rejects.toMatchObject({ code: "EXPIRED" });
		const canceled = await f.service.startTransfer(f.owner, f.org.id, {
			recipientMembershipId: recipientId,
			outgoingRole: "member",
		});
		await f.service.cancelTransfer(f.owner, f.org.id, canceled.id);
		await expect(
			f.service.acceptTransfer(recipient, f.org.id, {
				transferId: canceled.id,
				operationKey: "canceled",
			}),
		).rejects.toMatchObject({ code: "EXPIRED" });
		const stale = await f.service.startTransfer(f.owner, f.org.id, {
			recipientMembershipId: recipientId,
			outgoingRole: "member",
		});
		await f.app.query(
			"UPDATE tenancy.organizations SET ownership_version=ownership_version+1 WHERE id=$1",
			[f.org.id],
		);
		await expect(
			f.service.acceptTransfer(recipient, f.org.id, {
				transferId: stale.id,
				operationKey: "stale",
			}),
		).rejects.toMatchObject({ code: "CONFLICT" });
		await expect(
			f.service.acceptTransfer(recipient, randomUUID(), {
				transferId: stale.id,
				operationKey: "foreign",
			}),
		).rejects.toMatchObject({ code: "NOT_FOUND" });
	});
	it("revokes the sole owner without FGA, freezes access, and only verified fresh MFA recovery reopens after a real positive check", async () => {
		const f = await fixture(1),
			ownerId = (await f.service.readOrganization(f.owner, f.org.id)).membership
				.id,
			replacement = await f.user();
		const unavailable = createTenancyService(f.web, {
			...createAuthorizationService({
				controlPool: f.reader,
				installationId: f.installationId,
				openfgaUrl: "http://127.0.0.1:1",
			}),
			notify: f.notify,
		});
		await expect(
			unavailable.securityDeactivate(
				f.principal("security:deactivate"),
				f.org.id,
				{ membershipId: ownerId, operationKey: "security-off" },
			),
		).resolves.toEqual({ ownerRecoveryRequired: true });
		await unavailable.securityDeactivate(
			f.principal("security:deactivate"),
			f.org.id,
			{ membershipId: ownerId, operationKey: "security-off" },
		);
		expect(
			(
				await f.app.query(
					"SELECT occupied FROM tenancy.seat_capacities WHERE organization_id=$1",
					[f.org.id],
				)
			).rows[0].occupied,
		).toBe(0);
		await expect(
			f.service.readOrganization(f.owner, f.org.id),
		).rejects.toMatchObject({ code: "DENIED" });
		expect(await f.service.listOrganizations(f.owner)).toEqual([]);
		await expect(
			f.service.recoverOwner(f.principal("owner:recover"), f.org.id, {
				replacement: f.owner,
				operationKey: "restore-revoked",
			}),
		).rejects.toMatchObject({ code: "DENIED" });
		await expect(
			f.service.recoverOwner(
				{ ...f.principal("owner:recover"), mfaAt: new Date(0) },
				f.org.id,
				{ replacement, operationKey: "stale" },
			),
		).rejects.toMatchObject({ code: "DENIED" });
		await expect(
			unavailable.recoverOwner(f.principal("owner:recover"), f.org.id, {
				replacement,
				operationKey: "recovery",
			}),
		).rejects.toThrow();
		expect(
			(
				await f.app.query(
					"SELECT status FROM tenancy.organizations WHERE id=$1",
					[f.org.id],
				)
			).rows[0].status,
		).toBe("owner_recovery_required");
		expect(
			(
				await f.app.query(
					"SELECT occupied FROM tenancy.seat_capacities WHERE organization_id=$1",
					[f.org.id],
				)
			).rows[0].occupied,
		).toBe(0);
		await f.service.recoverOwner(f.principal("owner:recover"), f.org.id, {
			replacement,
			operationKey: "recovery",
		});
		expect(
			(await f.service.readOrganization(replacement, f.org.id)).membership.role,
		).toBe("owner");
		expect(
			(
				await f.app.query(
					"SELECT id FROM tenancy.owner_recovery_cases WHERE organization_id=$1",
					[f.org.id],
				)
			).rowCount,
		).toBe(1);
	});
	it("does not reopen recovery without seat capacity and does not restore deactivated transfer recipients", async () => {
		const f = await fixture(2),
			recipient = await f.user(),
			recipientId = await f.admit(recipient);
		const transfer = await f.service.startTransfer(f.owner, f.org.id, {
			recipientMembershipId: recipientId,
			outgoingRole: "inactive",
		});
		await f.service.securityDeactivate(
			f.principal("security:deactivate"),
			f.org.id,
			{ membershipId: recipientId, operationKey: "recipient-off" },
		);
		await expect(
			f.service.acceptTransfer(recipient, f.org.id, {
				transferId: transfer.id,
				operationKey: "accept-off",
			}),
		).rejects.toThrow();
		const ownerId = (await f.service.readOrganization(f.owner, f.org.id))
			.membership.id;
		await f.service.securityDeactivate(
			f.principal("security:deactivate"),
			f.org.id,
			{ membershipId: ownerId, operationKey: "owner-off" },
		);
		await f.app.query(
			"UPDATE tenancy.seat_capacities SET capacity=0 WHERE organization_id=$1",
			[f.org.id],
		);
		const replacement = await f.user();
		await expect(
			f.service.recoverOwner(f.principal("owner:recover"), f.org.id, {
				replacement,
				operationKey: "capacity",
			}),
		).rejects.toMatchObject({ code: "CAPACITY" });
		expect(
			(
				await f.app.query(
					"SELECT status FROM tenancy.organizations WHERE id=$1",
					[f.org.id],
				)
			).rows[0].status,
		).toBe("owner_recovery_required");
	});
	it("waits for global lifecycle freeze before admission without acquiring a user fence after organization locks", async () => {
		const f = await fixture(),
			member = await f.user(),
			invite = await f.invite(member),
			lock = await f.app.connect();
		try {
			await lock.query("BEGIN");
			await lock.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
				`user:${member.userId}`,
			]);
			const admission = f.service.acceptInvitation(member, f.org.id, {
				token: invite.token,
				operationKey: "freeze-race",
			});
			const observed = admission.then(
				() => "accepted",
				() => "denied",
			);
			await lock.query(
				"UPDATE identity.\"user\" SET lifecycle_status='frozen' WHERE id=$1",
				[member.userId],
			);
			await lock.query("COMMIT");
			expect(await observed).toBe("denied");
			expect(
				(await f.service.readOrganization(f.owner, f.org.id)).seats.occupied,
			).toBe(1);
		} finally {
			await lock.query("ROLLBACK").catch(() => undefined);
			lock.release();
		}
	});
	it("enforces tenant assurance and expiry on every request and provides idempotent teams and invitations", async () => {
		const f = await fixture(),
			member = await f.user();
		await f.admit(member);
		const input = {
			email: "invite@example.test",
			role: "member" as const,
			operationKey: "repeat-invite",
		};
		const a = await f.service.invite(f.owner, f.org.id, input),
			b = await f.service.invite(f.owner, f.org.id, input);
		expect(a).toEqual(b);
		const team = await f.service.createTeam(f.owner, f.org.id, {
			name: "Core",
			slug: "core",
		});
		expect(
			await f.service.createTeam(f.owner, f.org.id, {
				name: "Core",
				slug: "core",
			}),
		).toEqual(team);
		const memberId = (
			await f.service.readOrganization(f.owner, f.org.id)
		).members.find((row) => row.userId === member.userId)?.id;
		if (!memberId) throw new Error("missing");
		await f.service.setTeamMember(f.owner, f.org.id, {
			teamId: team.id,
			membershipId: memberId,
			present: true,
		});
		expect((await f.service.readOrganization(f.owner, f.org.id)).teams).toEqual(
			[{ id: team.id, name: "Core", membershipIds: [memberId] }],
		);
		await expect(
			f.service.removeTeam(member, f.org.id, team.id),
		).rejects.toThrow("Authorization denied");
		await expect(
			f.service.setTeamMember(member, f.org.id, {
				teamId: team.id,
				membershipId: memberId,
				present: false,
			}),
		).rejects.toThrow("Authorization denied");
		await f.service.setTeamMember(f.owner, f.org.id, {
			teamId: team.id,
			membershipId: memberId,
			present: false,
		});
		expect(
			(await f.service.readOrganization(f.owner, f.org.id)).teams[0]
				?.membershipIds,
		).toEqual([]);
		await f.service.setTeamMember(f.owner, f.org.id, {
			teamId: team.id,
			membershipId: memberId,
			present: true,
		});
		await f.service.removeTeam(f.owner, f.org.id, team.id);
		expect((await f.service.readOrganization(f.owner, f.org.id)).teams).toEqual(
			[],
		);
		expect(
			(
				await f.app.query(
					"SELECT membership_id FROM tenancy.team_members WHERE organization_id=$1 AND team_id=$2",
					[f.org.id, team.id],
				)
			).rows,
		).toEqual([]);
		await expect(
			f.service.setSecurityPolicy(member, f.org.id, {
				requireMfa: true,
				acceptPasskeyMfa: false,
				requiredAuthMethod: null,
			}),
		).rejects.toThrow("Authorization denied");
		await expect(
			f.service.setSecurityPolicy({ ...f.owner, mfa: false }, f.org.id, {
				requireMfa: true,
				acceptPasskeyMfa: false,
				requiredAuthMethod: null,
			}),
		).rejects.toMatchObject({ code: "DENIED" });
		await f.service.setSecurityPolicy(f.owner, f.org.id, {
			requireMfa: true,
			acceptPasskeyMfa: false,
			requiredAuthMethod: null,
		});
		await expect(
			f.service.readSummary(
				{ ...member, mfa: false, method: "magic-link" },
				f.org.id,
			),
		).rejects.toMatchObject({ code: "DENIED" });
		await expect(
			f.service.readSummary({ ...member, method: "passkey" }, f.org.id),
		).rejects.toMatchObject({ code: "DENIED" });
		await f.service.setSecurityPolicy(f.owner, f.org.id, {
			requireMfa: true,
			acceptPasskeyMfa: true,
			requiredAuthMethod: null,
		});
		expect(
			(await f.service.readSummary({ ...member, method: "passkey" }, f.org.id))
				.membership.id,
		).toBe(memberId);
		await f.app.query(
			"UPDATE tenancy.memberships SET expires_at=now()-interval '1 second' WHERE id=$1",
			[memberId],
		);
		await expect(f.service.readSummary(member, f.org.id)).rejects.toThrow(
			"Authorization denied",
		);
	});
	it("orders reciprocal transfers across organizations and resolves recipient deprovisioning races", async () => {
		const f = await fixture(),
			bob = await f.user(),
			bobMember = await f.admit(bob);
		const second = await f.service.createOrganization(bob, {
			slug: "reciprocal",
			name: "Reciprocal",
			operationKey: "second",
		});
		const invite = await f.service.invite(bob, second.id, {
			email: `${f.owner.userId}@example.test`,
			role: "member",
			operationKey: "alice",
		});
		const token = f.notices.find(
			(notice) => notice.referenceId === invite.id,
		)?.token;
		if (!token) throw new Error("missing invite");
		await f.service.acceptInvitation(f.owner, second.id, {
			token,
			operationKey: "alice-accept",
		});
		const aliceMember = (
			await f.service.readOrganization(bob, second.id)
		).members.find((member) => member.userId === f.owner.userId)?.id;
		if (!aliceMember) throw new Error("missing member");
		const a = await f.service.startTransfer(f.owner, f.org.id, {
			recipientMembershipId: bobMember,
			outgoingRole: "member",
		});
		const b = await f.service.startTransfer(bob, second.id, {
			recipientMembershipId: aliceMember,
			outgoingRole: "member",
		});
		await Promise.all([
			f.service.acceptTransfer(bob, f.org.id, {
				transferId: a.id,
				operationKey: "a",
			}),
			f.service.acceptTransfer(f.owner, second.id, {
				transferId: b.id,
				operationKey: "b",
			}),
		]);
		expect(
			(await f.service.readOrganization(bob, f.org.id)).membership.role,
		).toBe("owner");
		expect(
			(await f.service.readOrganization(f.owner, second.id)).membership.role,
		).toBe("owner");
		const next = await f.service.startTransfer(bob, f.org.id, {
			recipientMembershipId:
				(await f.service.readOrganization(bob, f.org.id)).members.find(
					(member) => member.userId === f.owner.userId,
				)?.id ?? "",
			outgoingRole: "member",
		});
		const originalOwner = (
			await f.service.readOrganization(bob, f.org.id)
		).members.find((member) => member.userId === f.owner.userId);
		if (!originalOwner) throw new Error("missing prior owner");
		const race = await Promise.allSettled([
			f.service.acceptTransfer(f.owner, f.org.id, {
				transferId: next.id,
				operationKey: "race",
			}),
			f.service.securityDeactivate(
				f.principal("security:deactivate"),
				f.org.id,
				{ membershipId: originalOwner.id, operationKey: "race-off" },
			),
		]);
		expect(race[1]?.status).toBe("fulfilled");
		const revoked = (
			await f.app.query("SELECT status FROM tenancy.memberships WHERE id=$1", [
				originalOwner.id,
			])
		).rows[0];
		expect(revoked.status).toBe("inactive");
		const owners = (
			await f.app.query(
				"SELECT id FROM tenancy.memberships WHERE organization_id=$1 AND role='owner' AND status='active'",
				[f.org.id],
			)
		).rowCount;
		const state = (
			await f.app.query(
				"SELECT status FROM tenancy.organizations WHERE id=$1",
				[f.org.id],
			)
		).rows[0].status;
		expect(state).toBe(owners ? "active" : "owner_recovery_required");
	});
	it("rejects a session revoked between transport authentication and the tenant fence", async () => {
		const f = await fixture();
		let checked = 0;
		const stale = {
			...f.owner,
			assertCurrent: async () => {
				checked++;
				throw new Error("Session revoked");
			},
		};
		await expect(
			f.service.createTeam(stale, f.org.id, { name: "Stale", slug: "stale" }),
		).rejects.toThrow("Session revoked");
		await expect(
			f.service.createOrganization(stale, {
				name: "Stale",
				slug: "stale",
				operationKey: "stale-session",
			}),
		).rejects.toThrow("Session revoked");
		await expect(f.service.listOrganizations(stale)).rejects.toThrow(
			"Session revoked",
		);
		expect(checked).toBe(3);
		expect((await f.service.readOrganization(f.owner, f.org.id)).teams).toEqual(
			[],
		);
	});
	it("rolls back a transfer when the newly admitted owner cannot complete current graph readiness", async () => {
		const f = await fixture(),
			recipient = await f.user(),
			recipientId = await f.admit(recipient);
		const transfer = await f.service.startTransfer(f.owner, f.org.id, {
			recipientMembershipId: recipientId,
			outgoingRole: "member",
		});
		const unavailable = createAuthorizationService({
			controlPool: f.reader,
			installationId: f.installationId,
			openfgaUrl: "http://127.0.0.1:1",
		});
		let sourceChanged = false;
		const fault = createTenancyService(f.web, {
			...f.authz,
			notify: f.notify,
			async sourceCommit(client, id) {
				await f.authz.sourceCommit(client, id);
				sourceChanged = true;
			},
			async authorize(client, actor, id, permission) {
				return (sourceChanged ? unavailable : f.authz).authorize(
					client,
					actor,
					id,
					permission,
				);
			},
		});
		await expect(
			fault.acceptTransfer(recipient, f.org.id, {
				transferId: transfer.id,
				operationKey: "readiness-failure",
			}),
		).rejects.toThrow();
		const snapshot = await f.service.readOrganization(f.owner, f.org.id);
		expect(snapshot.membership.role).toBe("owner");
		expect(
			snapshot.members.find((member) => member.userId === recipient.userId)
				?.role,
		).toBe("member");
		expect(
			snapshot.transfers.find((row) => row.id === transfer.id)?.status,
		).toBe("pending");
	});
	it("reserves privileged idempotency scope from ordinary membership commands", async () => {
		const f = await fixture(),
			own = (await f.service.readOrganization(f.owner, f.org.id)).membership;
		await expect(
			f.service.transitionMembership(f.owner, f.org.id, {
				membershipId: own.id,
				role: "owner",
				status: "active",
				billable: true,
				operationKey: "control:reserved",
			}),
		).rejects.toMatchObject({ code: "INVALID" });
		await expect(
			f.service.invite(f.owner, f.org.id, {
				email: "reserved@example.test",
				role: "member",
				operationKey: "control:reserved",
			}),
		).rejects.toMatchObject({ code: "INVALID" });
		await expect(
			f.service.createOrganization(f.owner, {
				name: "Reserved",
				slug: "reserved",
				operationKey: "control:reserved",
			}),
		).rejects.toMatchObject({ code: "INVALID" });
	});
	it("records trusted request/trace correlation and keeps one transaction fallback without personal email in domain events", async () => {
		const f = await fixture();
		const original = (
			await f.app.query(
				"SELECT request_id,trace_id FROM tenancy.audit_events WHERE organization_id=$1",
				[f.org.id],
			)
		).rows;
		expect(original).toHaveLength(2);
		expect(original[0].request_id).toMatch(/^[0-9a-f-]{36}$/);
		expect(original[0].request_id).toBe(original[1].request_id);
		expect(original[0].trace_id).toBeNull();
		const requestId = randomUUID(),
			traceId = "1234567890abcdef1234567890abcdef";
		const correlated = createTenancyService(f.web, {
			...f.authz,
			notify: f.notify,
			correlation: () => ({ requestId, traceId }),
		});
		const team = await correlated.createTeam(f.owner, f.org.id, {
			name: "Correlated",
			slug: "correlated",
		});
		expect(
			(
				await f.app.query(
					"SELECT request_id,trace_id FROM tenancy.audit_events WHERE target_id=$1",
					[team.id],
				)
			).rows,
		).toEqual([{ request_id: requestId, trace_id: traceId }]);
		const payloads = (
			await f.app.query(
				"SELECT payload FROM tenancy.outbox_events WHERE organization_id=$1",
				[f.org.id],
			)
		).rows;
		expect(JSON.stringify(payloads)).not.toContain("@example.test");
	});
});

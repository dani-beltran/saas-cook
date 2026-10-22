import { execFile, spawn } from "node:child_process";
import { createHash, generateKeyPairSync, randomUUID, sign } from "node:crypto";
import { promisify } from "node:util";
import { Pool } from "pg";
import { expect, it } from "vitest";
import { resourceFixture } from "../../../../scripts/phase3/fixture";
import { createAuthorizationService } from "../../../authz/src/index";
import {
	appendDeletion,
	readDeletionJournal,
} from "../../../authz/src/journal";
import { createApiKeyService } from "../../../authz/src/keys";
import {
	type RecoveryApproval,
	runRecovery,
} from "../../../authz/src/recovery";
import { dropTestDatabase } from "../../../testing/src/database";
import { createAnalyticsService } from "../analytics/service";
import { createResourceService } from "../resources";
import { createDeletionCleanup } from "./cleanup";
import { createRecoveryApplication } from "./recovery";
import { advanceDeletion, createLifecycleService } from "./service";

const exec = promisify(execFile),
	compose = ["compose", "-f", "infra/compose.yaml", "exec", "-T", "postgres"];
it("restores a real full application backup, preserves billing facts, replays independent provider cleanup and denies restored revoked authority", async () => {
	const f = await resourceFixture({ defaultProjectCreatesPerMonth: 20 });
	const name = `phase6_restore_${randomUUID().replaceAll("-", "")}`,
		source = new URL(f.installation.env.DATABASE_URL).pathname.slice(1);
	if (!/^phase2_test_[a-f0-9]{32}$/.test(source))
		throw new Error("Disposable snapshot required");
	const admin = new Pool({
			connectionString:
				process.env.TEST_DATABASE_ADMIN_URL ??
				"postgres://postgres:local_phase1@127.0.0.1:55433/postgres",
		}),
		control = new Pool({ connectionString: f.installation.controlUrl });
	const role = (name: string, db = source) => {
		const u = new URL(f.installation.env.DATABASE_URL);
		u.username = name;
		u.pathname = `/${db}`;
		return new Pool({ connectionString: u.toString() });
	};
	const lifecycle = role("saas_cook_lifecycle");
	let restored: Pool | undefined,
		restoredWeb: Pool | undefined,
		created = false;
	try {
		const owner = await f.user(),
			successor = await f.user(),
			revoked = await f.user();
		for (const u of [owner, successor, revoked])
			u.assertCurrent = async () => new Date(Date.now() + 60000);
		const keep = (await f.organization(owner)).id,
			remove = (await f.organization(owner)).id;
		const replacement = await f.member(owner, keep, successor),
			membership = await f.member(owner, keep, revoked);
		const project = await f.resources.createProject(owner, keep, {
			name: "Surviving organization data",
			slug: "surviving",
			operationKey: randomUUID(),
		});
		const direct = await f.resources.grant(owner, keep, {
			resourceId: project.id,
			subject: { kind: "membership", id: membership },
			relation: "viewer",
			operationKey: randomUUID(),
		});
		const keys = createApiKeyService({
			pool: f.web,
			authorization: f.authorization,
		});
		const machine = await keys.createAccount(owner, keep, {
			name: "Snapshot key",
			capabilities: [],
			operationKey: randomUUID(),
		});
		const key = await keys.issue(owner, keep, {
			serviceAccountId: machine.id,
			scopes: ["project:read"],
			expiresAt: new Date(Date.now() + 3600000),
			operationKey: randomUUID(),
		});
		const passkey = randomUUID();
		await f.identity.query(
			"INSERT INTO identity.passkey(id,user_id,public_key,credential_id,counter,device_type,backed_up) VALUES($1,$2,'synthetic-old-key',$1,0,'singleDevice',false)",
			[passkey, owner.userId],
		);
		for (const organization of [keep, remove]) {
			await f.app.query(
				"INSERT INTO tenancy.billing_invoices(organization_id,id,currency,amount_due,amount_paid,status,period_start,period_end) VALUES($1,$2,'eur',1000,1000,'paid','2026-01-01','2026-02-01')",
				[organization, `in_retained_${organization}`],
			);
		}
		const invoices = (
			await f.app.query(
				"SELECT * FROM tenancy.billing_invoices ORDER BY organization_id,id",
			)
		).rows;
		const usage = (
			await f.app.query("SELECT * FROM tenancy.usage_events ORDER BY sequence")
		).rows;
		expect(usage.length).toBeGreaterThan(0);
		const dump = await exec(
			"docker",
			[...compose, "pg_dump", "-U", "postgres", "--format=custom", source],
			{ encoding: "buffer", maxBuffer: 16 * 1024 * 1024, timeout: 30000 },
		);
		// These facts are deliberately newer than the application backup.
		const postBackupSubject = createHash("sha256")
			.update(randomUUID())
			.digest("hex");
		const postBackupEvent = randomUUID();
		await control.query("SELECT control.begin_analytics($1,$2,$3,$4,$5)", [
			f.installation.env.INSTALLATION_ID,
			postBackupSubject,
			owner.userId,
			remove,
			postBackupEvent,
		]);
		await control.query("SELECT control.settle_analytics($1,$2)", [
			f.installation.env.INSTALLATION_ID,
			postBackupEvent,
		]);
		await f.resources.revokeGrant(owner, keep, { grantId: direct.id });
		await keys.revoke(owner, keep, key.id);
		await f.identity.query("DELETE FROM identity.passkey WHERE id=$1", [
			passkey,
		]);
		await f.tenancy.transitionMembership(owner, keep, {
			membershipId: membership,
			role: "member",
			status: "inactive",
			billable: true,
			operationKey: randomUUID(),
		});
		const transfer = await f.tenancy.startTransfer(owner, keep, {
			recipientMembershipId: replacement,
			outgoingRole: "member",
		});
		await f.tenancy.acceptTransfer(successor, keep, {
			transferId: transfer.id,
			operationKey: randomUUID(),
		});
		const journal = {
			append: (id: string, record: Parameters<typeof appendDeletion>[3]) =>
				appendDeletion(control, f.installation.env.INSTALLATION_ID, id, record),
		};
		const service = createLifecycleService(
			lifecycle,
			{
				authorize: f.authorization.authorizeResource,
				sourceCommit: f.authorization.sourceCommit,
			},
			{ secret: f.installation.env.AUTH_SECRET, journal },
		);
		const cleanup = createDeletionCleanup(lifecycle, {
			analytics: { suppress: async () => true },
			sourceCommit: f.authorization.sourceCommit,
		});
		const orgRequest = await service.request(owner, {
			kind: "organization",
			organizationId: remove,
			operationKey: randomUUID(),
		});
		await service.confirm(owner, orgRequest.id);
		await advanceDeletion(lifecycle, journal, cleanup, orgRequest.id);
		const account = await service.request(owner, {
			kind: "account",
			operationKey: randomUUID(),
		});
		await service.confirm(owner, account.id);
		await advanceDeletion(lifecycle, journal, cleanup, account.id);
		expect((await service.status(account.id, account.receipt)).state).toBe(
			"complete",
		);
		expect(
			(
				await readDeletionJournal(control, f.installation.env.INSTALLATION_ID)
			).entries.some((e) =>
				e.record.resolutions?.some((r) => r.transferId === transfer.id),
			),
		).toBe(true);
		await admin.query(`CREATE DATABASE ${name} OWNER saas_cook_migrator`);
		created = true;
		await new Promise<void>((resolve, reject) => {
			const child = spawn(
				"docker",
				[
					...compose,
					"pg_restore",
					"-U",
					"postgres",
					"--no-owner",
					"--role=saas_cook_migrator",
					"--exit-on-error",
					"-d",
					name,
				],
				{ stdio: ["pipe", "ignore", "pipe"] },
			);
			let diagnostic = "";
			child.stderr.on("data", (b) => {
				diagnostic += b;
			});
			child.once("error", reject);
			child.once("exit", (code) =>
				code === 0
					? resolve()
					: reject(
							new Error(`Synthetic restore failed: ${diagnostic.slice(-1500)}`),
						),
			);
			child.stdin.end(dump.stdout);
		});
		restored = role("saas_cook_recovery", name);
		restoredWeb = role("saas_cook_web", name);
		const auth = createAuthorizationService({
			controlPool: f.reader,
			installationId: f.installation.env.INSTALLATION_ID,
			openfgaUrl: f.installation.env.OPENFGA_API_URL,
		});
		let providerAvailable = false;
		let providerRequests = 0;
		const analytics = createAnalyticsService(
			restored,
			{ authorize: auth.authorizeResource },
			{
				enabled: true,
				secret: f.installation.env.AUTH_SECRET,
				synthetic: true,
				ready: auth.publication,
				registry: {
					async register(id, user, organization, event) {
						await control.query(
							"SELECT control.begin_analytics($1,$2,$3,$4,$5)",
							[
								f.installation.env.INSTALLATION_ID,
								id,
								user,
								organization,
								event,
							],
						);
					},
					async settle(event) {
						await control.query("SELECT control.settle_analytics($1,$2)", [
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
					async capture() {
						throw new Error("Recovery may not ingest events");
					},
					async requestDeletion(subject) {
						providerRequests++;
						expect(subject).toBe(postBackupSubject);
						return {
							personIds: ["synthetic-post-backup-person"],
							requestedAt: new Date().toISOString(),
						};
					},
					async deletionComplete() {
						if (!providerAvailable)
							throw new Error("Synthetic provider outage");
						return true;
					},
				},
			},
		);
		const restoredCleanup = createDeletionCleanup(restored, {
				analytics,
				sourceCommit: auth.sourceCommit,
			}),
			application = createRecoveryApplication(restored, restoredCleanup);
		const keypair = generateKeyPairSync("ed25519"),
			publicKey = keypair.publicKey
				.export({ type: "spki", format: "pem" })
				.toString();
		let epoch = (await control.query("SELECT epoch FROM control.installations"))
			.rows[0].epoch as string;
		const applicationHash = await application.fingerprint();
		const call = async (
			action: RecoveryApproval["action"],
			adapter = application,
		) => {
			const claims: RecoveryApproval = {
				version: 1,
				installationId: f.installation.env.INSTALLATION_ID,
				epoch,
				nonce: randomUUID(),
				operatorId: "external-operator",
				mfaAt: new Date().toISOString(),
				expiresAt: new Date(Date.now() + 240000).toISOString(),
				evidenceReference: "independent:full-snapshot-drill",
				source: "independent-system-attestation",
				action,
				mode: "application",
				isolationEvidence: "isolated:snapshot-drill",
				applicationHash,
			};
			const bytes = Buffer.from(JSON.stringify(claims));
			return runRecovery({
				control,
				application: adapter,
				installationId: claims.installationId,
				openfgaUrl: f.installation.env.OPENFGA_API_URL,
				publicKey,
				envelope: JSON.stringify({
					payload: bytes.toString("base64url"),
					signature: sign(null, bytes, keypair.privateKey).toString(
						"base64url",
					),
				}),
			});
		};
		epoch = (await call("begin")).epoch;
		// A real restore outage interrupts replay; release must remain closed, then replay resumes.
		const interrupted = {
			...application,
			replay: async () => {
				throw new Error("synthetic interrupted purge");
			},
		};
		await expect(call("replay", interrupted)).rejects.toThrow(
			"interrupted purge",
		);
		await expect(call("release")).rejects.toThrow("Catch up");
		await expect(call("replay")).rejects.toThrow("cleanup pending: analytics");
		await expect(call("release")).rejects.toThrow("Catch up");
		expect(providerRequests).toBe(1);
		// The durable retry lease prevents a restarted replay from hammering the provider.
		await expect(call("replay")).rejects.toThrow("cleanup pending: analytics");
		expect(providerRequests).toBe(1);
		providerAvailable = true;
		const dependencyReturnedAt = performance.now();
		// Advance only this fixture's verification lease instead of sleeping its one-hour backoff.
		await restored.query(
			"UPDATE foundation.analytics_subjects SET receipt=jsonb_set(receipt,'{verification,nextCheckAt}','\"2000-01-01T00:00:00Z\"') WHERE id=$1",
			[postBackupSubject],
		);
		await call("replay");
		await call("replay");
		await call("release");
		expect(performance.now() - dependencyReturnedAt).toBeLessThan(60_000);
		expect(providerRequests).toBe(1);
		expect(
			(
				await restored.query(
					"SELECT suppressed,deletion_state FROM foundation.analytics_subjects WHERE id=$1",
					[postBackupSubject],
				)
			).rows[0],
		).toEqual({ suppressed: true, deletion_state: "complete" });
		const restoredStatus = createLifecycleService(
			restored,
			{
				authorize: f.authorization.authorizeResource,
				sourceCommit: f.authorization.sourceCommit,
			},
			{ secret: f.installation.env.AUTH_SECRET, journal },
		);
		expect(
			(await restoredStatus.status(account.id, account.receipt)).state,
		).toBe("complete");
		expect(
			(
				await restored.query("SELECT foundation.recovery_verify($1) AS valid", [
					epoch,
				])
			).rows[0].valid,
		).toBe(true);
		const restoredResources = createResourceService(restoredWeb, {
			authorize: auth.authorizeResource,
			check: auth.checkResource,
			checkBatch: auth.checkResourceBatch,
			sourceCommit: auth.sourceCommit,
		});
		for (const actor of [owner, successor, revoked])
			await expect(
				restoredResources.getProject(actor, keep, { id: project.id }),
			).rejects.toThrow();
		await expect(
			createApiKeyService({
				pool: restoredWeb,
				authorization: auth,
			}).authenticate(keep, key.secret),
		).rejects.toThrow();
		const inspect = new Pool({
			connectionString: (() => {
				const u = new URL(f.installation.migrationUrl);
				u.pathname = `/${name}`;
				return u.toString();
			})(),
		});
		try {
			expect(
				(
					await inspect.query(
						"SELECT * FROM tenancy.billing_invoices ORDER BY organization_id,id",
					)
				).rows,
			).toEqual(invoices);
			expect(
				(
					await inspect.query(
						"SELECT * FROM tenancy.usage_events ORDER BY sequence",
					)
				).rows,
			).toEqual(usage);
			expect(
				(await inspect.query("SELECT * FROM identity.passkey")).rowCount,
			).toBe(0);
			expect(
				(await inspect.query("SELECT * FROM tenancy.resource_grants")).rowCount,
			).toBe(0);
			expect(
				(
					await inspect.query(
						"SELECT * FROM tenancy.api_keys WHERE revoked_at IS NULL",
					)
				).rowCount,
			).toBe(0);
			expect(
				(
					await inspect.query(
						"SELECT status FROM tenancy.organizations WHERE id=$1",
						[keep],
					)
				).rows[0].status,
			).toBe("owner_recovery_required");
			expect(
				(
					await inspect.query(
						"SELECT name FROM tenancy.organizations WHERE id=$1",
						[remove],
					)
				).rows[0].name,
			).toBe("[deleted]");
			expect(
				(
					await inspect.query(
						"SELECT occupied FROM tenancy.seat_capacities WHERE organization_id=$1",
						[keep],
					)
				).rows[0].occupied,
			).toBe(0);
			expect(
				(
					await inspect.query(
						'SELECT lifecycle_status FROM identity."user" WHERE id=$1',
						[owner.userId],
					)
				).rows[0].lifecycle_status,
			).toBe("deleted");
		} finally {
			await inspect.end();
		}
	} finally {
		await Promise.all([
			restored?.end(),
			restoredWeb?.end(),
			lifecycle.end(),
			control.end(),
		]);
		if (created) await dropTestDatabase(admin, name);
		await admin.end();
		await f.cleanup();
	}
}, 60000);

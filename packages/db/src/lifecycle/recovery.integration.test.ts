import { generateKeyPairSync, randomUUID, sign } from "node:crypto";
import { Pool } from "pg";
import { describe, expect, it } from "vitest";
import { resourceFixture } from "../../../../scripts/phase3/fixture";
import { createApiKeyService } from "../../../authz/src/keys";
import {
	type RecoveryApproval,
	runRecovery,
	verifyRecoveryApproval,
} from "../../../authz/src/recovery";
import { createRecoveryApplication } from "./recovery";

const keys = generateKeyPairSync("ed25519");
const publicKey = keys.publicKey
	.export({ type: "spki", format: "pem" })
	.toString();
function envelope(c: RecoveryApproval) {
	const bytes = Buffer.from(JSON.stringify(c));
	return JSON.stringify({
		payload: bytes.toString("base64url"),
		signature: sign(null, bytes, keys.privateKey).toString("base64url"),
	});
}
describe("independently approved restore", () => {
	it("invalidates every restored credential and grant, keeps unknown owners closed, and requires new identity evidence", async () => {
		const f = await resourceFixture();
		const url = new URL(f.installation.env.DATABASE_URL);
		url.username = "saas_cook_recovery";
		const app = new Pool({ connectionString: url.toString() }),
			control = new Pool({ connectionString: f.installation.controlUrl });
		try {
			const owner = await f.user();
			owner.assertCurrent = async () => new Date(Date.now() + 60000);
			const org = await f.organization(owner);
			const p = await f.resources.createProject(owner, org.id, {
				name: "Restored",
				slug: `r-${randomUUID()}`,
				operationKey: randomUUID(),
			});
			const service = createApiKeyService({
				pool: f.web,
				authorization: f.authorization,
			});
			const sa = await service.createAccount(owner, org.id, {
				name: "Restored machine",
				capabilities: [],
				operationKey: randomUUID(),
			});
			await service.issue(owner, org.id, {
				serviceAccountId: sa.id,
				scopes: ["project:read"],
				expiresAt: new Date(Date.now() + 86400000),
				operationKey: randomUUID(),
			});
			await f.identity.query(
				"INSERT INTO identity.account(id,user_id,account_id,provider_id,password) VALUES($1,$2,$2,'credential','restored-password-hash')",
				[randomUUID(), owner.userId],
			);
			await f.identity.query(
				"INSERT INTO identity.passkey(id,user_id,public_key,credential_id,counter,device_type,backed_up) VALUES($1,$2,'old-key',$1,0,'singleDevice',false)",
				[randomUUID(), owner.userId],
			);
			const application = createRecoveryApplication(app, {
				async cleanup() {
					return true;
				},
			});
			let epoch = (
				await control.query(
					"SELECT epoch FROM control.installations WHERE installation_id=$1",
					[f.installation.env.INSTALLATION_ID],
				)
			).rows[0].epoch as string;
			const applicationHash = await application.fingerprint();
			const command = async (
				action: RecoveryApproval["action"],
				enrollment?: RecoveryApproval["enrollment"],
			) => {
				const claims: RecoveryApproval = {
					version: 1,
					installationId: f.installation.env.INSTALLATION_ID,
					epoch,
					nonce: randomUUID(),
					operatorId: "external-operator",
					mfaAt: new Date().toISOString(),
					expiresAt: new Date(Date.now() + 240000).toISOString(),
					evidenceReference: "independent:incident-1",
					source:
						action === "enroll"
							? "independent-identity"
							: "independent-system-attestation",
					action,
					mode: "application",
					isolationEvidence: "isolated-processes:incident-1",
					applicationHash,
					...(enrollment ? { enrollment } : {}),
				};
				return runRecovery({
					control,
					application,
					installationId: claims.installationId,
					openfgaUrl: f.installation.env.OPENFGA_API_URL,
					publicKey,
					envelope: envelope(claims),
				});
			};
			epoch = (await command("begin")).epoch;
			await expect(
				f.resources.getProject(owner, org.id, { id: p.id }),
			).rejects.toThrow();
			await expect(command("release")).rejects.toThrow("Catch up");
			await command("replay");
			await command("replay");
			expect(
				(await f.identity.query("SELECT * FROM identity.account")).rows,
			).toHaveLength(0);
			expect(
				(await f.identity.query("SELECT * FROM identity.passkey")).rows,
			).toHaveLength(0);
			expect(
				(await f.app.query("SELECT * FROM tenancy.resource_grants")).rows,
			).toHaveLength(0);
			expect(
				(
					await f.app.query(
						"SELECT occupied FROM tenancy.seat_capacities WHERE organization_id=$1",
						[org.id],
					)
				).rows[0].occupied,
			).toBe(0);
			expect(
				(await f.app.query("SELECT revoked_at FROM tenancy.api_keys")).rows[0]
					.revoked_at,
			).toBeTruthy();
			await command("enroll", {
				userId: owner.userId,
				verifiedEmail: "independently-verified@example.test",
			});
			await command("release");
			await expect(
				f.resources.getProject(owner, org.id, { id: p.id }),
			).rejects.toThrow();
			const principal = {
				operatorId: "external-operator",
				organizationId: org.id,
				scope: "owner:recover" as const,
				expiresAt: new Date(Date.now() + 240000),
				mfaAt: new Date(),
				evidenceReference: "independent:org-authority",
			};
			await f.tenancy.recoverOwner(principal, org.id, {
				replacement: owner,
				operationKey: `control:${randomUUID()}`,
			});
			expect(
				(await f.resources.getProject(owner, org.id, { id: p.id })).name,
			).toBe("Restored");
			expect(
				(
					await f.app.query(
						"SELECT occupied FROM tenancy.seat_capacities WHERE organization_id=$1",
						[org.id],
					)
				).rows[0].occupied,
			).toBe(1);
			await expect(
				f.web.query(
					"SELECT foundation.recovery_credentials($1,'application')",
					[randomUUID()],
				),
			).rejects.toMatchObject({ code: "42501" });
		} finally {
			await Promise.all([app.end(), control.end()]);
			await f.cleanup();
		}
	});
	it("rejects restored-only evidence, tampered approval and missing fresh MFA", () => {
		const c: RecoveryApproval = {
			version: 1,
			installationId: randomUUID(),
			epoch: randomUUID(),
			nonce: randomUUID(),
			operatorId: "operator-test",
			mfaAt: new Date().toISOString(),
			expiresAt: new Date(Date.now() + 240000).toISOString(),
			evidenceReference: "outside-backup:1",
			source: "independent-system-attestation",
			action: "begin",
			mode: "fga-only",
			isolationEvidence: "drained-processes:1",
			applicationHash: "a".repeat(64),
		};
		expect(verifyRecoveryApproval(envelope(c), publicKey).claims.mode).toBe(
			"fga-only",
		);
		expect(() =>
			verifyRecoveryApproval(
				envelope({
					...c,
					source: "restored-only" as RecoveryApproval["source"],
				}),
				publicKey,
			),
		).toThrow();
		expect(() =>
			verifyRecoveryApproval(
				envelope({ ...c, mfaAt: new Date(0).toISOString() }),
				publicKey,
			),
		).toThrow();
		const tampered = JSON.parse(envelope(c));
		tampered.payload = Buffer.from(
			JSON.stringify({ ...c, action: "release" }),
		).toString("base64url");
		expect(() =>
			verifyRecoveryApproval(JSON.stringify(tampered), publicKey),
		).toThrow();
	});
	it("requires intact-application attestation for FGA-only recovery and preserves verified current access", async () => {
		const f = await resourceFixture(),
			control = new Pool({ connectionString: f.installation.controlUrl });
		const url = new URL(f.installation.env.DATABASE_URL);
		url.username = "saas_cook_recovery";
		const app = new Pool({ connectionString: url.toString() });
		try {
			const owner = await f.user();
			owner.assertCurrent = async () => new Date(Date.now() + 60000);
			const org = await f.organization(owner);
			const application = createRecoveryApplication(app, {
				async cleanup() {
					return true;
				},
			});
			let epoch = (
				await control.query("SELECT epoch FROM control.installations")
			).rows[0].epoch as string;
			const applicationHash = await application.fingerprint();
			const call = async (
				action: RecoveryApproval["action"],
				fingerprint = applicationHash,
			) =>
				runRecovery({
					control,
					application,
					installationId: f.installation.env.INSTALLATION_ID,
					openfgaUrl: f.installation.env.OPENFGA_API_URL,
					publicKey,
					envelope: envelope({
						version: 1,
						installationId: f.installation.env.INSTALLATION_ID,
						epoch,
						nonce: randomUUID(),
						operatorId: "operator-test",
						mfaAt: new Date().toISOString(),
						expiresAt: new Date(Date.now() + 240000).toISOString(),
						evidenceReference: "external-intact-store:1",
						source: "independent-system-attestation",
						action,
						mode: "fga-only",
						isolationEvidence: "drained-processes:2",
						applicationHash: fingerprint,
					}),
				});
			await expect(call("begin", "0".repeat(64))).rejects.toThrow(
				"attestation mismatch",
			);
			epoch = (await call("begin")).epoch;
			await call("replay");
			await call("release");
			expect((await f.resources.listProjects(owner, org.id, {})).items).toEqual(
				[],
			);
			expect(
				(
					await f.identity.query(
						'SELECT lifecycle_status FROM identity."user" WHERE id=$1',
						[owner.userId],
					)
				).rows[0].lifecycle_status,
			).toBe("active");
		} finally {
			await Promise.all([app.end(), control.end()]);
			await f.cleanup();
		}
	});
});

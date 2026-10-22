import {
	createHash,
	createPublicKey,
	randomBytes,
	randomUUID,
	verify,
} from "node:crypto";
import { operatorPublication } from "@saas-cook/authz/platform";
import { organizationLookupInput } from "@saas-cook/backoffice-contracts";
import type { Pool } from "pg";
import { z } from "zod";

const claims = z.strictObject({
	version: z.literal(1),
	nonce: z.uuid(),
	installationId: z.uuid(),
	environment: z.enum(["development", "test", "production"]),
	epoch: z.uuid(),
	expiresAt: z.iso.datetime(),
	action: z.enum(["invite", "offboard", "reenroll"]),
	operatorId: z.uuid(),
	email: z.email(),
	name: z.string().min(1).max(120),
	organizationIds: z.array(z.uuid()).min(1).max(20),
	grantExpiresAt: z.iso.datetime(),
	caseReference: organizationLookupInput.shape.caseReference,
});
const envelope = z.strictObject({
	payload: z.string().max(16000),
	sponsor: z.string().max(200),
	security: z.string().max(200),
});
/** Executes one externally dual-signed staff management command; plaintext invitation is returned once, never logged. */
export async function manageOperator(options: {
	app: Pool;
	control: Pool;
	installationId: string;
	environment: string;
	sponsorPublicKey: string;
	securityPublicKey: string;
	approval: unknown;
}) {
	const e = envelope.parse(options.approval),
		body = Buffer.from(e.payload, "base64url"),
		input = claims.parse(JSON.parse(body.toString("utf8")));
	const sponsor = createPublicKey(options.sponsorPublicKey),
		security = createPublicKey(options.securityPublicKey);
	if (
		sponsor.asymmetricKeyType !== "ed25519" ||
		security.asymmetricKeyType !== "ed25519" ||
		sponsor.export({ type: "spki", format: "pem" }) ===
			security.export({ type: "spki", format: "pem" }) ||
		!verify(null, body, sponsor, Buffer.from(e.sponsor, "base64url")) ||
		!verify(null, body, security, Buffer.from(e.security, "base64url"))
	)
		throw new Error("Two independent approvals required");
	if (
		input.installationId !== options.installationId ||
		input.environment !== options.environment
	)
		throw new Error("Approval scope mismatch");
	const c = await options.app.connect();
	try {
		if (
			(await c.query("SELECT current_user")).rows[0].current_user !==
			"saas_cook_bo_manager"
		)
			throw new Error("Staff management role required");
		await c.query("BEGIN");
		await c.query("SET LOCAL lock_timeout='2s'");
		await c.query("SELECT pg_advisory_xact_lock_shared(1849202603)");
		await c.query("SELECT pg_advisory_xact_lock(1849202610)");
		const publication = await operatorPublication(
			options.control,
			c,
			options.installationId,
		);
		const time = (
			await c.query("SELECT clock_timestamp() AS now")
		).rows[0].now.getTime();
		if (
			input.epoch !== publication.epoch ||
			Date.parse(input.expiresAt) <= time ||
			Date.parse(input.expiresAt) > time + 300000 ||
			Date.parse(input.grantExpiresAt) <= time ||
			Date.parse(input.grantExpiresAt) > time + 90 * 86400000
		)
			throw new Error("Approval expired or outside limits");
		await c.query(
			"INSERT INTO backoffice.management_receipts(nonce,payload_hash) VALUES($1,$2)",
			[input.nonce, createHash("sha256").update(body).digest("hex")],
		);
		let invitation: string | undefined;
		if (input.action === "offboard") {
			const result = await c.query(
				`UPDATE operator_identity."user" SET status='disabled' WHERE id=$1`,
				[input.operatorId],
			);
			if (result.rowCount !== 1) throw new Error("Unknown operator");
			await c.query("DELETE FROM operator_identity.session WHERE user_id=$1", [
				input.operatorId,
			]);
			await c.query("DELETE FROM backoffice.grants WHERE user_id=$1", [
				input.operatorId,
			]);
			await c.query("DELETE FROM backoffice.invitations WHERE user_id=$1", [
				input.operatorId,
			]);
		} else {
			// Re-enrollment is a distinct dual-signed action, never inferred from a restored login.
			if (input.action === "reenroll") {
				const updated = await c.query(
					`UPDATE operator_identity."user" SET status='invited',epoch=$2,name=$3,email=$4 WHERE id=$1`,
					[
						input.operatorId,
						input.epoch,
						input.name,
						input.email.toLowerCase(),
					],
				);
				if (updated.rowCount !== 1) throw new Error("Unknown operator");
				for (const table of ["session", "passkey", "account"])
					await c.query(
						`DELETE FROM operator_identity.${table} WHERE user_id=$1`,
						[input.operatorId],
					);
				await c.query("DELETE FROM backoffice.invitations WHERE user_id=$1", [
					input.operatorId,
				]);
				await c.query("DELETE FROM backoffice.grants WHERE user_id=$1", [
					input.operatorId,
				]);
			} else {
				await c.query(
					`INSERT INTO operator_identity."user"(id,name,email,epoch) VALUES($1,$2,$3,$4)`,
					[
						input.operatorId,
						input.name,
						input.email.toLowerCase(),
						input.epoch,
					],
				);
			}
			invitation = randomBytes(32).toString("base64url");
			await c.query(
				"INSERT INTO backoffice.invitations(id,user_id,digest,epoch,expires_at) VALUES($1,$2,$3,$4,least($5::timestamptz,clock_timestamp()+interval '15 minutes'))",
				[
					randomUUID(),
					input.operatorId,
					createHash("sha256").update(invitation).digest("hex"),
					input.epoch,
					input.grantExpiresAt,
				],
			);
			for (const org of [...new Set(input.organizationIds)])
				await c.query(
					"INSERT INTO backoffice.grants VALUES($1,$2,$3,$4,$5,$6)",
					[
						randomUUID(),
						input.operatorId,
						org,
						input.epoch,
						input.environment,
						input.grantExpiresAt,
					],
				);
		}
		await c.query(
			"INSERT INTO backoffice.audit_events(id,actor_id,action,target_id,case_reference,outcome,epoch) VALUES($1,$6,$2,$3,$4,'allowed',$5)",
			[
				randomUUID(),
				`staff.${input.action}`,
				input.operatorId,
				input.caseReference,
				input.epoch,
				[sponsor, security]
					.map((key) =>
						createHash("sha256")
							.update(key.export({ type: "spki", format: "der" }))
							.digest("hex"),
					)
					.join(":"),
			],
		);
		if (
			(await operatorPublication(options.control, c, options.installationId))
				.epoch !== input.epoch ||
			!(
				await c.query("SELECT $1::timestamptz>clock_timestamp() AS valid", [
					input.expiresAt,
				])
			).rows[0].valid
		)
			throw new Error("Approval no longer current");
		await c.query("COMMIT");
		return { operatorId: input.operatorId, invitation };
	} catch (e) {
		await c.query("ROLLBACK");
		throw e;
	} finally {
		c.release();
	}
}

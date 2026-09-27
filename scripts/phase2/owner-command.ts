import { randomUUID } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import { createAuthorizationService, getPublication } from "@saas-cook/authz";
import { initializeControlStore } from "@saas-cook/authz/control";
import { verifyOperatorApproval } from "@saas-cook/authz/operator";
import { createTenancyService, type TenancyHooks } from "@saas-cook/db/tenancy";
import type { Pool } from "pg";

/** Privileged one-off entry, never mounted as a public tenant endpoint. */
export async function runOwnerCommand(options: {
	mode: "owner-recovery" | "security-deactivate";
	approvalFile: string;
	publicKey: string;
	applicationPool: Pool;
	controlPool: Pool;
	installationId: string;
	openfgaUrl: string;
	notify: TenancyHooks["notify"];
}): Promise<void> {
	if ((await stat(options.approvalFile)).size > 16_384)
		throw new Error("Operator approval exceeds size limit");
	const envelope = await readFile(options.approvalFile, "utf8");
	await initializeControlStore(options.controlPool);
	const control = await options.controlPool.connect();
	try {
		const state = (
			await control.query(
				"SELECT epoch FROM control.installations WHERE installation_id=$1 AND state IN ('ready','recovery_required')",
				[options.installationId],
			)
		).rows[0];
		if (!state) throw new Error("Existing independent installation required");
		const verified = verifyOperatorApproval(envelope, options.publicKey, {
			installationId: options.installationId,
			epoch: state.epoch,
			scope:
				options.mode === "owner-recovery"
					? "owner:recover"
					: "security:deactivate",
		});
		const { claims, payloadHash } = verified;
		await control.query("SET lock_timeout='5s'");
		await control.query("SELECT pg_advisory_lock(hashtextextended($1,0))", [
			`operator:${claims.nonce}`,
		]);
		try {
			const existing = (
				await control.query(
					"SELECT payload_hash,state FROM control.operator_approvals WHERE nonce=$1",
					[claims.nonce],
				)
			).rows[0];
			if (existing && existing.payload_hash !== payloadHash)
				throw new Error("Operator approval nonce already used");
			if (existing?.state === "completed") return;
			if (options.mode === "owner-recovery") {
				const current = await getPublication(
					options.controlPool,
					options.installationId,
				);
				if (current.epoch !== claims.epoch)
					throw new Error("Operator approval epoch changed");
			}
			// Persist verified scope/evidence outside the application restore boundary before any local mutation.
			await control.query(
				`INSERT INTO control.operator_approvals(nonce,installation_id,epoch,payload_hash,claims,state)
        VALUES($1,$2,$3,$4,$5,'pending') ON CONFLICT(nonce) DO NOTHING`,
				[
					claims.nonce,
					claims.installationId,
					claims.epoch,
					payloadHash,
					JSON.stringify(claims),
				],
			);
			const operationKey = `control:${claims.nonce}`;
			const client = await options.applicationPool.connect();
			let committed = false;
			try {
				const role = (await client.query("SELECT current_user")).rows[0]
					.current_user;
				if (role !== "saas_cook_web")
					throw new Error(
						"Operator command requires restricted application web role",
					);
				await client.query("BEGIN");
				await client.query("SELECT set_config('app.organization_id',$1,true)", [
					claims.organizationId,
				]);
				const binding = await client.query(
					"SELECT 1 FROM foundation.installation WHERE installation_id=$1",
					[claims.installationId],
				);
				if (binding.rowCount !== 1)
					throw new Error(
						"Operator approval targets another application installation",
					);
				if (claims.scope === "security:deactivate") {
					const member = await client.query(
						"SELECT 1 FROM tenancy.memberships WHERE organization_id=$1 AND id=$2 AND user_id=$3",
						[claims.organizationId, claims.membershipId, claims.subjectUserId],
					);
					if (member.rowCount !== 1)
						throw new Error("Approval membership/subject mismatch");
				}
				// Only an exact signed-command receipt proves this privileged transaction committed.
				// Ordinary user-provided idempotency keys never establish operator completion.
				committed =
					(
						await client.query(
							`SELECT 1 FROM tenancy.audit_events WHERE organization_id=$1 AND action='operator.approval_applied'
                             AND target_id=$2 AND actor_id=$3 AND changes->>'payloadHash'=$4 AND changes->>'scope'=$5 AND changes->>'subjectUserId'=$6`,
							[
								claims.organizationId,
								claims.nonce,
								claims.operatorId,
								payloadHash,
								claims.scope,
								claims.subjectUserId,
							],
						)
					).rowCount === 1;
				await client.query("COMMIT");
			} catch (error) {
				await client.query("ROLLBACK").catch(() => {});
				throw error;
			} finally {
				client.release();
			}
			if (!committed) {
				const requestId = randomUUID();
				const authorization = createAuthorizationService({
					controlPool: options.controlPool,
					installationId: options.installationId,
					openfgaUrl: options.openfgaUrl,
				});
				const service = createTenancyService(options.applicationPool, {
					...authorization,
					correlation: () => ({ requestId }),
					async sourceCommit(connection, organizationId) {
						await authorization.sourceCommit(connection, organizationId);
						const id = randomUUID();
						const changes = JSON.stringify({
							payloadHash,
							scope: claims.scope,
							subjectUserId: claims.subjectUserId,
						});
						await connection.query(
							"INSERT INTO tenancy.audit_events(id,organization_id,actor_id,action,target_id,changes,request_id) VALUES($1,$2,$3,'operator.approval_applied',$4,$5,$6)",
							[
								id,
								organizationId,
								claims.operatorId,
								claims.nonce,
								changes,
								requestId,
							],
						);
						await connection.query(
							"INSERT INTO tenancy.outbox_events(id,organization_id,type,payload) VALUES($1,$2,'operator.approval_applied',$3)",
							[
								id,
								organizationId,
								JSON.stringify({
									nonce: claims.nonce,
									payloadHash,
									scope: claims.scope,
									subjectUserId: claims.subjectUserId,
								}),
							],
						);
					},
					notify: options.notify,
				});
				const principal = {
					operatorId: claims.operatorId,
					organizationId: claims.organizationId,
					scope: claims.scope,
					expiresAt: new Date(claims.expiresAt),
					mfaAt: new Date(claims.mfaAt),
					evidenceReference: claims.evidenceReference,
				};
				if (claims.scope === "owner:recover")
					await service.recoverOwner(principal, claims.organizationId, {
						operationKey,
						replacement: {
							userId: claims.subjectUserId,
							authenticatedAt: new Date(claims.subjectAuthenticatedAt ?? ""),
							mfa: true,
							method: claims.subjectMethod ?? "",
						},
					});
				else
					await service.securityDeactivate(principal, claims.organizationId, {
						operationKey,
						membershipId: claims.membershipId ?? "",
					});
			}
			await control.query(
				"UPDATE control.operator_approvals SET state='completed',completed_at=clock_timestamp(),result=$2 WHERE nonce=$1",
				[
					claims.nonce,
					JSON.stringify({
						action: claims.scope,
						organizationId: claims.organizationId,
						subjectUserId: claims.subjectUserId,
					}),
				],
			);
		} finally {
			await control
				.query("SELECT pg_advisory_unlock(hashtextextended($1,0))", [
					`operator:${claims.nonce}`,
				])
				.catch(() => {});
		}
	} finally {
		control.release();
	}
}

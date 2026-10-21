import type { Pool, PoolClient } from "pg";
import type { RecoveryApplication } from "../../../authz/src/recovery";
import { type MembershipRole, transitionMembership } from "../tenancy";
import type { DeletionCleanup, DeletionRow } from "./service";

/** Dedicated command-only role. It has no DDL or generic cross-tenant update permission. */
export function createRecoveryApplication(
	pool: Pool,
	cleanup: DeletionCleanup,
): RecoveryApplication {
	async function transaction<T>(work: (c: PoolClient) => Promise<T>) {
		const c = await pool.connect();
		try {
			if (
				(await c.query("SELECT current_user")).rows[0].current_user !==
				"saas_cook_recovery"
			)
				throw new Error("Dedicated recovery application role required");
			await c.query("BEGIN");
			await c.query("SET LOCAL lock_timeout='5s'");
			await c.query("SELECT pg_advisory_xact_lock(1849202603)");
			const value = await work(c);
			await c.query("COMMIT");
			return value;
		} catch (e) {
			await c.query("ROLLBACK");
			throw e;
		} finally {
			c.release();
		}
	}
	return {
		async fingerprint() {
			return (
				await pool.query("SELECT foundation.security_fingerprint() AS hash")
			).rows[0].hash as string;
		},
		async reset(mode, epoch, expectedFingerprint) {
			await transaction(async (c) => {
				if (
					(
						await c.query(
							"SELECT 1 FROM foundation.recovery_state WHERE epoch=$1",
							[epoch],
						)
					).rowCount
				)
					return;
				if (
					mode === "fga-only" &&
					(await c.query("SELECT foundation.security_fingerprint() AS hash"))
						.rows[0].hash !== expectedFingerprint
				)
					throw new Error("Intact application changed before recovery reset");
				await c.query("SELECT foundation.recovery_credentials($1,$2)", [
					epoch,
					mode,
				]);
				if (mode === "fga-only") return;
				await c.query("SELECT foundation.recovery_platform()");
				const orgs = (
					await c.query<{ id: string; status: string }>(
						"SELECT * FROM foundation.recovery_organizations()",
					)
				).rows;
				for (const org of orgs) {
					await c.query(
						"SELECT set_config('app.organization_id',$1,true),pg_advisory_xact_lock(hashtextextended($2,0))",
						[org.id, `organization:${org.id}`],
					);
					await c.query(
						"SELECT id FROM tenancy.organizations WHERE id=$1 FOR UPDATE",
						[org.id],
					);
					await c.query(
						"SELECT organization_id FROM tenancy.seat_capacities WHERE organization_id=$1 FOR UPDATE",
						[org.id],
					);
					// Reconcile restored occupancy, then use the same idempotent admission/release service.
					await c.query(
						"UPDATE tenancy.seat_capacities SET occupied=(SELECT count(*) FROM tenancy.memberships WHERE organization_id=$1 AND seat_counted) WHERE organization_id=$1",
						[org.id],
					);
					const members = (
						await c.query(
							"SELECT * FROM tenancy.memberships WHERE organization_id=$1 ORDER BY user_id",
							[org.id],
						)
					).rows;
					for (const m of members)
						await transitionMembership(c, org.id, "recovery", {
							userId: m.user_id,
							role: (m.role === "billing"
								? "billing"
								: "member") as MembershipRole,
							status: "inactive",
							billable: m.role !== "billing",
							securityOverride: true,
							operationKey: `control:restore:${epoch}:${m.id}`,
						});
					await c.query(
						"UPDATE tenancy.organizations SET status=CASE WHEN status='suspended' THEN status ELSE 'owner_recovery_required' END WHERE id=$1",
						[org.id],
					);
					await c.query(
						"DELETE FROM tenancy.resource_grants WHERE organization_id=$1",
						[org.id],
					);
					await c.query(
						"DELETE FROM tenancy.team_members WHERE organization_id=$1",
						[org.id],
					);
					await c.query(
						"UPDATE tenancy.api_keys SET revoked_at=coalesce(revoked_at,clock_timestamp()) WHERE organization_id=$1",
						[org.id],
					);
					await c.query(
						"UPDATE tenancy.service_accounts SET status='inactive',version=version+1 WHERE organization_id=$1",
						[org.id],
					);
					await c.query(
						"UPDATE tenancy.projects SET owner_membership_id=NULL WHERE organization_id=$1",
						[org.id],
					);
					await c.query(
						"UPDATE tenancy.invitations SET status='canceled' WHERE organization_id=$1 AND status='pending'",
						[org.id],
					);
					await c.query(
						"UPDATE tenancy.ownership_transfers SET status='canceled' WHERE organization_id=$1 AND status='pending'",
						[org.id],
					);
				}
			});
		},
		async replay(journal) {
			const requests = new Map<string, (typeof journal.entries)[number]>();
			for (const e of journal.entries) requests.set(e.record.requestId, e);
			for (const { record: r, sequence } of requests.values()) {
				if (r.action === "canceled") continue;
				await transaction(async (c) => {
					await c.query(
						`INSERT INTO foundation.deletion_requests(id,subject_kind,subject_id,requester_id,operation_key,status_hash,state,organizations,retained,steps,journal_sequence,effective_at,resolutions) VALUES($1::uuid,$2,$3,$3,$1::text,$9,'journal_pending',$4,$5,'[]',$6,$7,$8) ON CONFLICT(id) DO UPDATE SET state='journal_pending',steps='[]',journal_sequence=$6,resolutions=$8,status_hash=$9`,
						[
							r.requestId,
							r.subjectKind,
							r.subjectId,
							JSON.stringify(r.organizations),
							JSON.stringify(r.retained),
							sequence,
							r.effectiveAt,
							JSON.stringify(r.resolutions ?? []),
							r.statusHash ?? "0".repeat(64),
						],
					);
					if (r.subjectKind === "account")
						await c.query("SELECT foundation.lifecycle_identity($1,false)", [
							r.requestId,
						]);
					else {
						await c.query("SELECT set_config('app.organization_id',$1,true)", [
							r.subjectId,
						]);
						await c.query(
							"UPDATE tenancy.organizations SET status='suspended' WHERE id=$1",
							[r.subjectId],
						);
					}
					await c.query(
						"UPDATE foundation.deletion_requests SET state='purging' WHERE id=$1",
						[r.requestId],
					);
				});
				const row = (
					await pool.query<DeletionRow>(
						"SELECT * FROM foundation.deletion_requests WHERE id=$1",
						[r.requestId],
					)
				).rows[0];
				for (const step of [
					"files",
					"analytics",
					"billing",
					"integrations",
					"local",
				] as const)
					if (!(await cleanup.cleanup(row, step)))
						throw new Error(`Recovery deletion cleanup pending: ${step}`);
				await pool.query(
					"UPDATE foundation.deletion_requests SET state='complete',steps=$2,completed_at=clock_timestamp() WHERE id=$1",
					[
						r.requestId,
						JSON.stringify([
							"files",
							"analytics",
							"billing",
							"integrations",
							"local",
						]),
					],
				);
			}
		},
		async enroll(userId, email, epoch) {
			await transaction((c) =>
				c.query("SELECT foundation.recovery_enroll($1,$2,$3)", [
					userId,
					email,
					epoch,
				]),
			);
		},
		async publish(p) {
			await transaction((c) =>
				c.query("SELECT foundation.recovery_publish($1,$2,$3,$4)", [
					p.epoch,
					p.storeId,
					p.modelId,
					p.modelHash,
				]),
			);
		},
		async verify(epoch) {
			if (
				!(
					await pool.query("SELECT foundation.recovery_verify($1) AS valid", [
						epoch,
					])
				).rows[0].valid
			)
				throw new Error("Recovery verification incomplete");
		},
	};
}

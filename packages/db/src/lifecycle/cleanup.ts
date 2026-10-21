import type { Pool } from "pg";
import type { BillingProvider } from "../billing/provider";
import type { FileStorage } from "../files/storage";
import { settleCapacityReservation } from "../resources";
import {
	type MembershipRole,
	transitionMembership,
	withTenantTransaction,
} from "../tenancy";
import type { DeletionCleanup } from "./service";
export function createDeletionCleanup(
	pool: Pool,
	options: {
		storage?: FileStorage;
		billing?: BillingProvider;
		analytics: {
			suppress(kind: "account" | "organization", id: string): Promise<boolean>;
		};
		sourceCommit: (c: import("pg").PoolClient, org: string) => Promise<unknown>;
	},
): DeletionCleanup {
	return {
		async cleanup(r, step) {
			if (step === "analytics")
				return options.analytics.suppress(r.subject_kind, r.subject_id);
			if (step === "billing") {
				if (r.subject_kind === "account") return true;
				const account = await withTenantTransaction(
					pool,
					r.subject_id,
					[],
					true,
					async (c) => {
						await c.query(
							"UPDATE tenancy.billing_commands SET state='failed' WHERE organization_id=$1 AND state IN ('pending','submitted')",
							[r.subject_id],
						);
						return (
							await c.query(
								"SELECT customer_id FROM tenancy.billing_accounts WHERE organization_id=$1",
								[r.subject_id],
							)
						).rows[0];
					},
				);
				if (!account?.customer_id) return true;
				if (!options.billing) return false;
				const truth = await options.billing.truth(account.customer_id);
				if (
					!truth.subscription ||
					["canceled", "incomplete_expired"].includes(truth.subscription.status)
				)
					return true;
				await options.billing.cancel(`deletion:${r.id}`, truth.subscription);
				return false;
			}
			if (step === "files") {
				let complete = true;
				for (const org of [...r.organizations].sort()) {
					await withTenantTransaction(
						pool,
						org,
						r.subject_kind === "account" ? [r.subject_id] : [],
						true,
						async (c) => {
							const files =
								r.subject_kind === "organization"
									? (
											await c.query(
												"SELECT id,reservation_id,created_at FROM tenancy.files WHERE organization_id=$1 AND state<>'deleted' LIMIT 10",
												[org],
											)
										).rows
									: [];
							const jobs = (
								await c.query(
									"SELECT id,reservation_id FROM tenancy.bulk_jobs WHERE organization_id=$1 AND state<>'expired' AND ($2='organization' OR requester_id=$3) LIMIT 10",
									[org, r.subject_kind, r.subject_id],
								)
							).rows;
							if ((files.length || jobs.length) && !options.storage) {
								complete = false;
								return;
							}
							for (const [kind, rows] of [
								["files", files],
								["bulk_jobs", jobs],
							] as const)
								for (const row of rows) {
									// Initiation can reissue a five-minute URL for ten minutes. Drain that
									// window plus five minutes before removing the create-once object.
									if (
										kind === "files" &&
										row.created_at.getTime() + 20 * 60000 > Date.now()
									) {
										complete = false;
										continue;
									}
									await options.storage?.clearAttempt(
										`staging/${org}/${row.id}`,
										`quarantine/${org}/${row.id}`,
									);
									const reservation = (
										await c.query(
											"SELECT state,bucket_id,quantity FROM tenancy.capacity_reservations WHERE organization_id=$1 AND id=$2",
											[org, row.reservation_id],
										)
									).rows[0];
									if (reservation?.state === "reserved")
										await settleCapacityReservation(
											c,
											org,
											row.reservation_id,
											"released",
										);
									else if (reservation?.state === "committed") {
										await c.query(
											"UPDATE tenancy.capacity_buckets SET consumed=consumed-$3 WHERE organization_id=$1 AND id=$2",
											[org, reservation.bucket_id, reservation.quantity],
										);
										await c.query(
											"UPDATE tenancy.capacity_reservations SET state='released' WHERE organization_id=$1 AND id=$2",
											[org, row.reservation_id],
										);
									}
									if (kind === "files")
										await c.query(
											"UPDATE tenancy.files SET state='deleted',object=NULL,name='[deleted]' WHERE organization_id=$1 AND id=$2",
											[org, row.id],
										);
									else
										await c.query(
											"UPDATE tenancy.bulk_jobs SET state='expired',draft=NULL,object=NULL,input='{}',manifest='[]' WHERE organization_id=$1 AND id=$2",
											[org, row.id],
										);
								}
							if (files.length === 10 || jobs.length === 10) complete = false;
						},
						undefined,
						false,
					);
				}
				return complete;
			}
			if (step === "integrations") {
				if (r.subject_kind === "organization")
					await withTenantTransaction(
						pool,
						r.subject_id,
						[],
						true,
						async (c) => {
							await c.query(
								"UPDATE tenancy.webhook_endpoints SET state='revoked',secret=NULL,previous_secret=NULL,version=version+1 WHERE organization_id=$1",
								[r.subject_id],
							);
							await c.query(
								"UPDATE tenancy.integration_connections SET state='revoked',secret=NULL,version=version+1 WHERE organization_id=$1",
								[r.subject_id],
							);
							await c.query(
								"UPDATE tenancy.webhook_deliveries SET state='canceled' WHERE organization_id=$1 AND state='pending'",
								[r.subject_id],
							);
						},
					);
				return true;
			}
			// Restored membership occupancy is drained with the same release service as ordinary deletion.
			for (const org of [...r.organizations].sort())
				await withTenantTransaction(
					pool,
					org,
					r.subject_kind === "account" ? [r.subject_id] : [],
					true,
					async (c) => {
						const members = (
							await c.query(
								"SELECT * FROM tenancy.memberships WHERE organization_id=$1 AND ($2='organization' OR user_id=$3) ORDER BY user_id",
								[org, r.subject_kind, r.subject_id],
							)
						).rows;
						for (const m of members) {
							await transitionMembership(c, org, "system:deletion", {
								userId: m.user_id,
								membershipId: m.id,
								role: m.role as MembershipRole,
								status: "inactive",
								billable: m.billable,
								securityOverride: true,
								operationKey: `control:purge:${r.id}:${m.id}`,
							});
							await c.query(
								"DELETE FROM tenancy.resource_grants WHERE organization_id=$1 AND membership_id=$2",
								[org, m.id],
							);
							await c.query(
								"DELETE FROM tenancy.team_members WHERE organization_id=$1 AND membership_id=$2",
								[org, m.id],
							);
							await c.query(
								"UPDATE tenancy.projects SET owner_membership_id=NULL WHERE organization_id=$1 AND owner_membership_id=$2",
								[org, m.id],
							);
						}
						if (r.subject_kind === "account")
							await c.query(
								"UPDATE tenancy.organizations SET status='owner_recovery_required' WHERE id=$1 AND status='active' AND NOT EXISTS(SELECT 1 FROM tenancy.memberships WHERE organization_id=$1 AND role='owner' AND status='active')",
								[org],
							);
						await options.sourceCommit(c, org);
					},
				);
			if (r.subject_kind === "account")
				await pool.query("SELECT foundation.purge_identity_messages($1)", [
					r.id,
				]);
			await pool.query("SELECT foundation.lifecycle_local($1)", [r.id]);
			return true;
		},
	};
}

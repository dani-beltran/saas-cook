import type { Pool, PoolClient } from "pg";
import { assertBinding, getPublication } from "./control";
import { checkContext } from "./fga";
import { compileContext, modelHash, type Permission, type Role } from "./model";
import { createResourceAuthorization } from "./resources";

export { getPublication } from "./control";
export { ApiKeyError, createApiKeyService } from "./keys";
export {
	type AuthzResourceActor,
	ResourceAuthorizationDenied,
	type ServiceResourceActor,
} from "./resources";
export function createAuthorizationService(options: {
	controlPool: Pool;
	installationId: string;
	openfgaUrl: string;
}) {
	async function publication(client: PoolClient) {
		const state = await getPublication(
			options.controlPool,
			options.installationId,
		);
		await assertBinding(client, state);
		return state;
	}
	async function initialize(client: PoolClient, organizationId: string) {
		const state = await publication(client);
		await client.query(
			`INSERT INTO tenancy.authorization_revisions (organization_id,store_id,model_id,model_hash,recovery_epoch)
      VALUES($1,$2,$3,$4,$5)`,
			[organizationId, state.storeId, state.modelId, modelHash, state.epoch],
		);
	}
	async function sourceCommit(client: PoolClient, organizationId: string) {
		// Revocations cannot depend on OpenFGA availability or an independently ready control plane.
		// This never stamps a new epoch or makes a restored row ready.
		const changed = await client.query(
			`UPDATE tenancy.authorization_revisions
      SET desired_revision=desired_revision+1, applied_revision=desired_revision+1,updated_at=clock_timestamp()
      WHERE organization_id=$1 AND evaluation_mode='contextual-v1' RETURNING desired_revision`,
			[organizationId],
		);
		if (changed.rowCount !== 1)
			throw new Error("Missing contextual authorization source");
	}
	async function authorize(
		client: PoolClient,
		actorId: string,
		organizationId: string,
		permission: Permission,
		teamId?: string,
	) {
		if (
			!["read", "manage", "transfer", "billing"].includes(permission) ||
			(teamId && permission !== "read" && permission !== "manage")
		)
			throw new Error("Unsupported permission");
		const state = await publication(client);
		const source = await client.query(
			`SELECT m.role,m.id,m.expires_at FROM tenancy.memberships m
      JOIN tenancy.organizations o ON o.id=m.organization_id
      JOIN tenancy.authorization_revisions r ON r.organization_id=o.id
      WHERE m.organization_id=$1 AND m.user_id=$2 AND m.status='active' AND o.status='active'
        AND (m.expires_at IS NULL OR m.expires_at>clock_timestamp())
        AND r.ready AND r.desired_revision=r.applied_revision AND r.evaluation_mode='contextual-v1'
        AND r.recovery_epoch=$3 AND r.store_id=$4 AND r.model_id=$5 AND r.model_hash=$6`,
			[
				organizationId,
				actorId,
				state.epoch,
				state.storeId,
				state.modelId,
				modelHash,
			],
		);
		const membership = source.rows[0];
		if (!membership) throw new Error("Authorization denied");
		const account = await client.query(
			"SELECT lifecycle_status,email_verified FROM identity.lookup_user($1)",
			[actorId],
		);
		if (
			account.rows[0]?.lifecycle_status !== "active" ||
			!account.rows[0]?.email_verified
		)
			throw new Error("Authorization denied");
		let teamMember = false;
		if (teamId) {
			const team = await client.query(
				`SELECT EXISTS(SELECT 1 FROM tenancy.team_members tm WHERE tm.organization_id=t.organization_id AND tm.team_id=t.id AND tm.membership_id=$3) AS member
        FROM tenancy.teams t WHERE t.organization_id=$1 AND t.id=$2`,
				[organizationId, teamId, membership.id],
			);
			if (!team.rowCount) throw new Error("Authorization denied");
			teamMember = team.rows[0].member;
		}
		const context = compileContext({
			organizationId,
			epoch: state.epoch,
			actorId,
			role: membership.role as Role,
			teamId,
			teamMember,
		});
		if (
			!(await checkContext(
				options.openfgaUrl,
				state.storeId,
				state.modelId,
				context,
				permission,
			))
		)
			throw new Error("Authorization denied");
		const current = await getPublication(
			options.controlPool,
			options.installationId,
		);
		if (
			current.epoch !== state.epoch ||
			current.modelId !== state.modelId ||
			current.storeId !== state.storeId
		)
			throw new Error("Independent authorization publication changed");
		// A late remote allow is useless when its lock-bearing application connection was lost.
		// Recheck trusted time after remote latency, on the same live transaction connection.
		const stillEligible = await client.query(
			"SELECT $1::timestamptz IS NULL OR $1::timestamptz > clock_timestamp() AS eligible",
			[membership.expires_at],
		);
		if (!stillEligible.rows[0]?.eligible)
			throw new Error("Authorization expired");
	}
	return {
		initialize,
		sourceCommit,
		authorize,
		publication,
		...createResourceAuthorization(options),
	};
}

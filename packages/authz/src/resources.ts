import { createHash } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import { getPublication, type Publication } from "./control";
import { checkContext } from "./fga";
import {
	type ContextGrant,
	compileResourceContext,
	modelHash,
	type ResourcePermission,
	type ResourceTarget,
	type Role,
} from "./model";

export interface HumanResourceActor {
	kind?: never;
	userId: string;
	authenticatedAt: Date;
	mfa: boolean;
	method: string;
	assertCurrent?: () => Promise<Date | undefined> | Promise<void>;
}
export interface ServiceResourceActor {
	kind: "service";
	organizationId: string;
	serviceAccountId: string;
	apiKeyId: string;
	scopes: readonly string[];
	token: string;
}
export type AuthzResourceActor = HumanResourceActor | ServiceResourceActor;
export class ResourceAuthorizationDenied extends Error {
	constructor() {
		super("Resource authorization denied");
	}
}
export const keyScopes = [
	"read",
	"create",
	"update",
	"delete",
	"restore",
	"manage",
	"share",
].map((action) => `project:${action}`);
export const hashKey = (token: string) =>
	createHash("sha256").update(token).digest("hex");

/** Call only on the connection holding the organization fence and tenant setting. */
export async function currentServiceKey(
	client: PoolClient,
	organizationId: string,
	token: string,
	state: Publication,
) {
	if (!/^cs_[a-f0-9]{32}_[A-Za-z0-9_-]{43}$/.test(token))
		throw new ResourceAuthorizationDenied();
	const result = await client.query<{
		id: string;
		service_account_id: string;
		scopes: string[];
		capabilities: string[];
		expires_at: Date;
	}>(
		`SELECT k.id,k.service_account_id,k.scopes,k.expires_at,s.capabilities FROM tenancy.api_keys k
		 JOIN tenancy.service_accounts s ON s.organization_id=k.organization_id AND s.id=k.service_account_id
		 WHERE k.organization_id=$1 AND k.secret_hash=$2 AND k.revoked_at IS NULL
		 AND k.expires_at>clock_timestamp() AND k.recovery_epoch=$3 AND s.status='active'`,
		[organizationId, hashKey(token), state.epoch],
	);
	const key = result.rows[0];
	if (
		!key?.scopes.length ||
		key.scopes.some((scope) => !keyScopes.includes(scope)) ||
		key.capabilities.some(
			(capability) => !["project:read", "project:create"].includes(capability),
		)
	)
		throw new ResourceAuthorizationDenied();
	return key;
}

export function createResourceAuthorization(options: {
	controlPool: Pool;
	installationId: string;
	openfgaUrl: string;
}) {
	async function prepareResource(
		client: PoolClient,
		actor: AuthzResourceActor,
		organizationId: string,
		target: ResourceTarget,
		permission: ResourcePermission,
	) {
		if (
			![
				"read",
				"create",
				"update",
				"delete",
				"restore",
				"manage",
				"share",
			].includes(permission) ||
			!["organization", "project"].includes(target.type) ||
			(target.resourceType !== undefined && target.resourceType !== "project")
		)
			throw new ResourceAuthorizationDenied();
		if (
			target.type === "organization" &&
			(target.id !== organizationId ||
				!["read", "create", "manage"].includes(permission))
		)
			throw new ResourceAuthorizationDenied();
		const state = await getPublication(
			options.controlPool,
			options.installationId,
		);
		const isService = "kind" in actor && actor.kind === "service";
		const sessionDeadline = isService
			? undefined
			: await actor.assertCurrent?.();
		if (
			isService &&
			(actor.organizationId !== organizationId ||
				(target.type === "organization" && permission === "manage"))
		)
			throw new ResourceAuthorizationDenied();
		type SourceGrant = {
			resource_id: string;
			relation: ContextGrant["relation"];
			team_id: string | null;
			expires_at: string | null;
		};
		const source = (
			await client.query<{
				require_mfa: boolean;
				accept_passkey_mfa: boolean;
				required_auth_method: string | null;
				lifecycle_status: string | null;
				email_verified: boolean | null;
				membership_id: string | null;
				role: Role | null;
				membership_expires_at: Date | null;
				resource_id: string | null;
				deleted_at: Date | null;
				grants: SourceGrant[];
			}>(
				`SELECT o.require_mfa,o.accept_passkey_mfa,o.required_auth_method,u.lifecycle_status,u.email_verified,
		 m.id AS membership_id,m.role,m.expires_at AS membership_expires_at,
		 target.id AS resource_id,target.deleted_at,
		 coalesce(grants.edges,'[]'::jsonb) AS grants
		 FROM tenancy.organizations o JOIN tenancy.authorization_revisions revision ON revision.organization_id=o.id
		 LEFT JOIN LATERAL identity.lookup_user($7::text) u ON $7::text IS NOT NULL
		 LEFT JOIN tenancy.memberships m ON m.organization_id=o.id AND m.user_id=$7 AND m.status='active' AND (m.expires_at IS NULL OR m.expires_at>clock_timestamp())
		 LEFT JOIN tenancy.resource_registry target ON target.organization_id=o.id AND target.id=$8 AND target.resource_type=$9
		 LEFT JOIN LATERAL (SELECT jsonb_agg(edge) AS edges FROM (
		  SELECT g.resource_id,g.relation,g.team_id,g.expires_at FROM tenancy.resource_grants g
		  WHERE g.organization_id=o.id AND g.resource_id=target.id
		  AND (g.expires_at IS NULL OR g.expires_at>clock_timestamp())
		  AND ((m.id IS NOT NULL AND (g.membership_id=m.id OR EXISTS(SELECT 1 FROM tenancy.team_members tm WHERE tm.organization_id=g.organization_id AND tm.team_id=g.team_id AND tm.membership_id=m.id))) OR ($10::uuid IS NOT NULL AND g.service_account_id=$10)) LIMIT 101
		 ) edge) grants ON true
		 WHERE o.id=$1 AND o.status='active' AND revision.ready AND revision.desired_revision=revision.applied_revision AND revision.evaluation_mode='contextual-v1'
		 AND revision.recovery_epoch=$2 AND revision.store_id=$3 AND revision.model_id=$4 AND revision.model_hash=$5
		 AND EXISTS(SELECT 1 FROM foundation.installation WHERE installation_id=$6 AND binding_id=$11 AND recovery_epoch=$2)`,
				[
					organizationId,
					state.epoch,
					state.storeId,
					state.modelId,
					modelHash,
					state.installationId,
					isService ? null : actor.userId,
					target.id,
					target.type,
					isService ? actor.serviceAccountId : null,
					state.bindingId,
				],
			)
		).rows[0];
		if (!source) throw new ResourceAuthorizationDenied();
		const expirations: Date[] = sessionDeadline ? [sessionDeadline] : [];
		let actorId: string;
		let membershipId: string | null = null;
		let role: Role | undefined;
		let creator = false;
		let serviceScopes: readonly string[] | undefined;
		if (isService) {
			const key = await currentServiceKey(
				client,
				organizationId,
				actor.token,
				state,
			);
			if (
				key.id !== actor.apiKeyId ||
				key.service_account_id !== actor.serviceAccountId
			)
				throw new ResourceAuthorizationDenied();
			const resourceType =
				target.type === "organization" ? target.resourceType : target.type;
			if (
				!resourceType ||
				!key.scopes.includes(`${resourceType}:${permission}`) ||
				(target.type === "organization" &&
					!key.capabilities.includes(`${resourceType}:${permission}`))
			)
				throw new ResourceAuthorizationDenied();
			serviceScopes = key.scopes;
			creator =
				permission === "create" &&
				key.capabilities.includes(`${resourceType}:create`);
			actorId = key.service_account_id;
			expirations.push(key.expires_at);
		} else {
			if (
				source.lifecycle_status !== "active" ||
				!source.email_verified ||
				!source.membership_id ||
				!source.role
			)
				throw new ResourceAuthorizationDenied();
			if (
				(source.require_mfa &&
					(!actor.mfa ||
						(actor.method === "passkey" && !source.accept_passkey_mfa))) ||
				(source.required_auth_method &&
					actor.method !== source.required_auth_method)
			)
				throw new ResourceAuthorizationDenied();
			actorId = actor.userId;
			membershipId = source.membership_id;
			role = source.role;
			creator = role !== "billing";
			if (source.membership_expires_at)
				expirations.push(source.membership_expires_at);
		}
		const grants: ContextGrant[] = [];
		if (target.type !== "organization") {
			if (
				!source.resource_id ||
				(source.deleted_at && !["delete", "restore"].includes(permission))
			)
				throw new ResourceAuthorizationDenied();
			if (source.grants.length > 100)
				throw new Error("Authorization context too large");
			for (const grant of source.grants) {
				grants.push({
					resourceId: grant.resource_id,
					relation: grant.relation,
					...(grant.team_id ? { teamId: grant.team_id } : {}),
				});
				if (grant.expires_at) expirations.push(new Date(grant.expires_at));
			}
			if (
				role !== "owner" &&
				role !== "admin" &&
				!grants.some((grant) => grant.relation !== "denied")
			)
				throw new ResourceAuthorizationDenied();
		}
		const context = compileResourceContext({
			organizationId,
			epoch: state.epoch,
			actorId,
			actorType: isService ? "service_account" : "user",
			role,
			creator,
			target,
			grants,
		});
		return {
			state,
			context,
			expirations,
			permission,
			actorId,
			membershipId,
			role,
			isService,
			creator,
			serviceScopes,
		};
	}
	type Prepared = Awaited<ReturnType<typeof prepareResource>>;
	async function remote(prepared: Prepared) {
		const { state, context, permission } = prepared;
		return checkContext(
			options.openfgaUrl,
			state.storeId,
			state.modelId,
			context,
			permission,
		);
	}
	async function finish(client: PoolClient, prepared: Prepared) {
		const { state, expirations } = prepared;
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
		// This SQL proves the lock-bearing transaction remains alive after remote latency.
		const eligible = await client.query(
			`WITH deadline AS MATERIALIZED (SELECT least(nullif(current_setting('app.authorization_expires_at',true),'')::timestamptz,(SELECT min(expiry) FROM unnest($1::timestamptz[]) expiry)) AS expires_at) SELECT set_config('app.authorization_expires_at',coalesce(expires_at::text,''),true),expires_at IS NULL OR expires_at>clock_timestamp() AS eligible FROM deadline`,
			[expirations],
		);
		if (!eligible.rows[0]?.eligible) throw new ResourceAuthorizationDenied();
	}
	async function authorizeResource(
		...args: Parameters<typeof prepareResource>
	) {
		const prepared = await prepareResource(...args);
		if (!(await remote(prepared))) throw new ResourceAuthorizationDenied();
		await finish(args[0], prepared);
	}
	/** One bounded source snapshot per page. Only the remote checks run concurrently. */
	async function checkResourceBatch(
		client: PoolClient,
		actor: AuthzResourceActor,
		org: string,
		checks: Array<{ target: ResourceTarget; permission: ResourcePermission }>,
	) {
		if (checks.length > 20)
			throw new Error("Authorization candidate batch too large");
		if (!checks.length) return [];
		const type = checks[0]?.target.type;
		if (
			!type ||
			type === "organization" ||
			checks.some(
				({ target, permission }) =>
					target.type !== type || !["read", "restore"].includes(permission),
			)
		)
			throw new Error("Unsupported authorization batch");
		const common = await prepareResource(
			client,
			actor,
			org,
			{ type: "organization", id: org, resourceType: type },
			"read",
		);
		const ids = checks.map(({ target }) => target.id);
		const records = await client.query<{
			id: string;
			resource_type: string;
			deleted_at: Date | null;
		}>(
			`SELECT id,resource_type,deleted_at FROM tenancy.resource_registry WHERE organization_id=$1 AND id=ANY($2::uuid[])`,
			[org, ids],
		);
		const registry = new Map(records.rows.map((row) => [row.id, row]));
		const rows = await client.query<{
			resource_id: string;
			relation: ContextGrant["relation"];
			team_id: string | null;
			expires_at: Date | null;
		}>(
			`SELECT g.resource_id,g.relation,g.team_id,g.expires_at FROM tenancy.resource_grants g
		 WHERE g.organization_id=$1 AND g.resource_id=ANY($2::uuid[]) AND (g.expires_at IS NULL OR g.expires_at>clock_timestamp())
		 AND (($3::uuid IS NOT NULL AND (g.membership_id=$3 OR EXISTS(SELECT 1 FROM tenancy.team_members tm WHERE tm.organization_id=g.organization_id AND tm.team_id=g.team_id AND tm.membership_id=$3))) OR ($4::uuid IS NOT NULL AND g.service_account_id=$4)) LIMIT 2001`,
			[
				org,
				[...registry.keys()],
				common.membershipId,
				common.isService ? common.actorId : null,
			],
		);
		if (rows.rows.length > 2000)
			throw new Error("Authorization context too large");
		const prepared: Array<Prepared | null> = checks.map(
			({ target, permission }) => {
				const row = registry.get(target.id);
				if (
					!row ||
					row.resource_type !== target.type ||
					(row.deleted_at && permission !== "restore") ||
					(common.isService &&
						!common.serviceScopes?.includes(`${target.type}:${permission}`))
				)
					return null;
				const source = rows.rows.filter(
					(grant) => grant.resource_id === target.id,
				);
				if (source.length > 100)
					throw new Error("Authorization context too large");
				if (
					common.role !== "owner" &&
					common.role !== "admin" &&
					!source.some((grant) => grant.relation !== "denied")
				)
					return null;
				const grants = source.map((grant) => ({
					resourceId: grant.resource_id,
					relation: grant.relation,
					...(grant.team_id ? { teamId: grant.team_id } : {}),
				}));
				const context = compileResourceContext({
					organizationId: org,
					epoch: common.state.epoch,
					actorId: common.actorId,
					actorType: common.isService ? "service_account" : "user",
					role: common.role,
					creator: common.creator,
					target,
					grants,
				});
				return {
					...common,
					context,
					permission,
					expirations: [
						...common.expirations,
						...source.flatMap((grant) =>
							grant.expires_at ? [grant.expires_at] : [],
						),
					],
				};
			},
		);
		const allowed = await Promise.all(
			prepared.map((item) => (item ? remote(item) : false)),
		);
		const current = await getPublication(
			options.controlPool,
			options.installationId,
		);
		if (
			current.epoch !== common.state.epoch ||
			current.modelId !== common.state.modelId ||
			current.storeId !== common.state.storeId
		)
			throw new Error("Independent authorization publication changed");
		const expirations = prepared.flatMap((item, index) =>
			item && allowed[index] ? item.expirations : [],
		);
		const eligible = await client.query<{ eligible: boolean }>(
			`WITH deadline AS MATERIALIZED (SELECT least(nullif(current_setting('app.authorization_expires_at',true),'')::timestamptz,(SELECT min(expiry) FROM unnest($1::timestamptz[]) expiry)) AS expires_at) SELECT set_config('app.authorization_expires_at',coalesce(expires_at::text,''),true),expires_at IS NULL OR expires_at>clock_timestamp() AS eligible FROM deadline`,
			[expirations],
		);
		if (!eligible.rows[0]?.eligible) throw new ResourceAuthorizationDenied();
		return allowed;
	}

	async function checkResource(...args: Parameters<typeof authorizeResource>) {
		try {
			await authorizeResource(...args);
			return true;
		} catch (error) {
			if (error instanceof ResourceAuthorizationDenied) return false;
			throw error;
		}
	}
	return { authorizeResource, checkResource, checkResourceBatch };
}

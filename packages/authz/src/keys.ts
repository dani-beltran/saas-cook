import { randomBytes, randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import type { createAuthorizationService } from "./index";
import {
	currentServiceKey,
	type HumanResourceActor,
	hashKey,
	keyScopes,
	ResourceAuthorizationDenied,
	type ServiceResourceActor,
} from "./resources";

export class ApiKeyError extends Error {
	constructor(
		public readonly code: "DENIED" | "NOT_FOUND" | "INVALID" | "CONFLICT",
		message = code,
	) {
		super(message);
	}
}

export function createApiKeyService(options: {
	pool: Pool;
	authorization: ReturnType<typeof createAuthorizationService>;
}) {
	async function transaction<T>(
		org: string,
		actor: HumanResourceActor | null,
		exclusive: boolean,
		work: (client: PoolClient) => Promise<T>,
	) {
		const client = await options.pool.connect();
		try {
			await client.query("BEGIN");
			await client.query(
				"SELECT set_config('app.authorization_expires_at','',true)",
			);
			await client.query("SET LOCAL statement_timeout='8s'");
			await client.query("SET LOCAL lock_timeout='5s'");
			await client.query("SELECT set_config('app.request_id',$1,true)", [
				randomUUID(),
			]);
			if (actor)
				await client.query(
					"SELECT pg_advisory_xact_lock_shared(hashtextextended($1,0))",
					[`user:${actor.userId}`],
				);
			await client.query(
				exclusive
					? "SELECT pg_advisory_xact_lock(hashtextextended($1,0))"
					: "SELECT pg_advisory_xact_lock_shared(hashtextextended($1,0))",
				[`organization:${org}`],
			);
			await client.query("SELECT set_config('app.organization_id',$1,true)", [
				org,
			]);
			if (actor) {
				if (
					!Number.isFinite(actor.authenticatedAt.getTime()) ||
					actor.authenticatedAt.getTime() > Date.now() ||
					Date.now() - actor.authenticatedAt.getTime() > 300_000
				)
					throw new ApiKeyError("DENIED");
				await options.authorization.authorizeResource(
					client,
					actor,
					org,
					{ type: "organization", id: org },
					"manage",
				);
				// Retain session/membership deadlines and bound fresh authentication too.
				const eligibility = await client.query<{ eligible: boolean }>(
					`WITH deadline AS MATERIALIZED (SELECT least(nullif(current_setting('app.authorization_expires_at',true),'')::timestamptz,$1::timestamptz+interval '5 minutes') AS expires_at)
					SELECT set_config('app.authorization_expires_at',expires_at::text,true),$1::timestamptz<=clock_timestamp() AND expires_at>clock_timestamp() AS eligible FROM deadline`,
					[actor.authenticatedAt],
				);
				if (eligibility.rows[0]?.eligible !== true)
					throw new ApiKeyError("DENIED");
			}
			const result = await work(client);
			if (actor) {
				// Natural expiry can occur during domain SQL even while lifecycle fences hold.
				const validity = await client.query<{ valid: boolean }>(
					"SELECT nullif(current_setting('app.authorization_expires_at',true),'')::timestamptz>clock_timestamp() AS valid",
				);
				if (validity.rows[0]?.valid !== true) throw new ApiKeyError("DENIED");
			}
			await client.query("COMMIT");
			return result;
		} catch (error) {
			await client.query("ROLLBACK").catch(() => {});
			throw error;
		} finally {
			client.release();
		}
	}
	function scopes(values: readonly string[], capabilities = false) {
		if (
			(!capabilities && !values.length) ||
			values.length > keyScopes.length ||
			new Set(values).size !== values.length ||
			values.some(
				(value) =>
					!keyScopes.includes(value) ||
					(capabilities && !/^(project|workspace):(read|create)$/.test(value)),
			)
		)
			throw new ApiKeyError("INVALID");
	}
	function commandId(
		org: string,
		actor: HumanResourceActor,
		operationKey: string,
		scope: string,
	) {
		if (
			!operationKey ||
			operationKey.length > 128 ||
			operationKey.startsWith("control:")
		)
			throw new ApiKeyError("INVALID");
		const digest = hashKey(
			JSON.stringify([org, actor.userId, scope, operationKey]),
		);
		return `${digest.slice(0, 8)}-${digest.slice(8, 12)}-4${digest.slice(13, 16)}-8${digest.slice(17, 20)}-${digest.slice(20, 32)}`;
	}

	function expiry(value: Date) {
		if (
			!Number.isFinite(value.getTime()) ||
			value.getTime() <= Date.now() ||
			value.getTime() > Date.now() + 366 * 24 * 60 * 60 * 1000
		)
			throw new ApiKeyError("INVALID");
	}
	async function audit(
		client: PoolClient,
		org: string,
		actor: string,
		action: string,
		target: string,
	) {
		const id = randomUUID();
		await client.query(
			"INSERT INTO tenancy.audit_events(id,organization_id,actor_id,action,target_id,changes,request_id) VALUES($1,$2,$3,$4,$5,'{}',nullif(current_setting('app.request_id',true),'')::uuid)",
			[id, org, actor, action, target],
		);
		await client.query(
			"INSERT INTO tenancy.outbox_events(id,organization_id,type,payload) VALUES($1,$2,$3,$4)",
			[id, org, action, JSON.stringify({ targetId: target })],
		);
		await options.authorization.sourceCommit(client, org);
	}
	async function issue(
		client: PoolClient,
		actor: HumanResourceActor,
		org: string,
		input: {
			serviceAccountId: string;
			scopes: string[];
			expiresAt: Date;
			operationKey: string;
		},
		command = "key.issue",
	) {
		scopes(input.scopes);
		expiry(input.expiresAt);
		const account = await client.query(
			"SELECT 1 FROM tenancy.service_accounts WHERE organization_id=$1 AND id=$2 AND status='active'",
			[org, input.serviceAccountId],
		);
		if (!account.rowCount) throw new ApiKeyError("NOT_FOUND");
		const state = await options.authorization.publication(client);
		const id = commandId(org, actor, input.operationKey, command);
		if (
			(
				await client.query(
					"SELECT 1 FROM tenancy.api_keys WHERE organization_id=$1 AND id=$2",
					[org, id],
				)
			).rowCount
		)
			throw new ApiKeyError("CONFLICT");
		const prefix = `cs_${id.replaceAll("-", "")}`;
		const secret = `${prefix}_${randomBytes(32).toString("base64url")}`;
		await client.query(
			"INSERT INTO tenancy.api_keys(id,organization_id,service_account_id,prefix,secret_hash,scopes,expires_at,recovery_epoch) VALUES($1,$2,$3,$4,$5,$6,$7,$8)",
			[
				id,
				org,
				input.serviceAccountId,
				prefix,
				hashKey(secret),
				input.scopes,
				input.expiresAt,
				state.epoch,
			],
		);
		await audit(client, org, actor.userId, "api_key.issued", id);
		return { id, secret, prefix, expiresAt: input.expiresAt.toISOString() };
	}
	return {
		async authenticate(
			organizationId: string,
			token: string,
		): Promise<ServiceResourceActor> {
			return transaction(organizationId, null, false, async (client) => {
				const state = await options.authorization.publication(client);
				const active = await client.query(
					"SELECT 1 FROM tenancy.organizations o JOIN tenancy.authorization_revisions r ON r.organization_id=o.id WHERE o.id=$1 AND o.status='active' AND r.ready AND r.recovery_epoch=$2 AND r.store_id=$3 AND r.model_id=$4 AND r.model_hash=$5 AND r.desired_revision=r.applied_revision",
					[
						organizationId,
						state.epoch,
						state.storeId,
						state.modelId,
						state.modelHash,
					],
				);
				if (!active.rowCount) throw new ResourceAuthorizationDenied();
				const key = await currentServiceKey(
					client,
					organizationId,
					token,
					state,
				);
				return {
					kind: "service",
					organizationId,
					serviceAccountId: key.service_account_id,
					apiKeyId: key.id,
					scopes: key.scopes,
					token,
				};
			});
		},
		async createAccount(
			actor: HumanResourceActor,
			org: string,
			input: { name: string; capabilities: string[]; operationKey: string },
		) {
			if (!input.name.trim() || input.name.length > 120)
				throw new ApiKeyError("INVALID");
			scopes(input.capabilities, true);
			return transaction(org, actor, true, async (client) => {
				const id = commandId(
					org,
					actor,
					input.operationKey,
					"service_account.create",
				);
				const existing = (
					await client.query<{
						id: string;
						name: string;
						status: "active" | "inactive";
						capabilities: string[];
						version: number;
					}>(
						"SELECT id,name,status,capabilities,version FROM tenancy.service_accounts WHERE organization_id=$1 AND id=$2",
						[org, id],
					)
				).rows[0];
				if (existing) {
					if (
						existing.name !== input.name.trim() ||
						JSON.stringify([...existing.capabilities].sort()) !==
							JSON.stringify([...input.capabilities].sort())
					)
						throw new ApiKeyError("CONFLICT");
					return existing;
				}
				await client.query(
					"INSERT INTO tenancy.service_accounts(id,organization_id,name,capabilities) VALUES($1,$2,$3,$4)",
					[id, org, input.name.trim(), input.capabilities],
				);
				await audit(client, org, actor.userId, "service_account.created", id);
				return {
					id,
					name: input.name.trim(),
					status: "active" as const,
					capabilities: input.capabilities,
					version: 1,
				};
			});
		},
		async issue(
			actor: HumanResourceActor,
			org: string,
			input: {
				serviceAccountId: string;
				scopes: string[];
				expiresAt: Date;
				operationKey: string;
			},
		) {
			return transaction(org, actor, true, (client) =>
				issue(client, actor, org, input),
			);
		},
		async rotate(
			actor: HumanResourceActor,
			org: string,
			input: { keyId: string; expiresAt: Date; operationKey: string },
		) {
			return transaction(org, actor, true, async (client) => {
				const nextId = commandId(org, actor, input.operationKey, "key.rotate");
				if (
					(
						await client.query(
							"SELECT 1 FROM tenancy.api_keys WHERE organization_id=$1 AND id=$2",
							[org, nextId],
						)
					).rowCount
				)
					throw new ApiKeyError("CONFLICT");
				const old = (
					await client.query<{ service_account_id: string; scopes: string[] }>(
						"UPDATE tenancy.api_keys SET revoked_at=clock_timestamp() WHERE organization_id=$1 AND id=$2 AND revoked_at IS NULL RETURNING service_account_id,scopes",
						[org, input.keyId],
					)
				).rows[0];
				if (!old) throw new ApiKeyError("NOT_FOUND");
				await audit(client, org, actor.userId, "api_key.rotated", input.keyId);
				return issue(
					client,
					actor,
					org,
					{
						serviceAccountId: old.service_account_id,
						scopes: old.scopes,
						expiresAt: input.expiresAt,
						operationKey: input.operationKey,
					},
					"key.rotate",
				);
			});
		},
		async revoke(actor: HumanResourceActor, org: string, keyId: string) {
			return transaction(org, actor, true, async (client) => {
				const changed = await client.query(
					"UPDATE tenancy.api_keys SET revoked_at=coalesce(revoked_at,clock_timestamp()) WHERE organization_id=$1 AND id=$2 RETURNING id",
					[org, keyId],
				);
				if (!changed.rowCount) throw new ApiKeyError("NOT_FOUND");
				await audit(client, org, actor.userId, "api_key.revoked", keyId);
			});
		},
		async setAccountStatus(
			actor: HumanResourceActor,
			org: string,
			input: { id: string; status: "active" | "inactive"; version: number },
		) {
			if (
				!["active", "inactive"].includes(input.status) ||
				!Number.isSafeInteger(input.version) ||
				input.version < 1
			)
				throw new ApiKeyError("INVALID");
			return transaction(org, actor, true, async (client) => {
				const account = (
					await client.query<{
						id: string;
						name: string;
						status: "active" | "inactive";
						capabilities: string[];
						version: number;
					}>(
						"UPDATE tenancy.service_accounts SET status=$3,version=version+1,updated_at=clock_timestamp() WHERE organization_id=$1 AND id=$2 AND version=$4 RETURNING id,name,status,capabilities,version",
						[org, input.id, input.status, input.version],
					)
				).rows[0];
				if (!account) throw new ApiKeyError("CONFLICT");
				if (input.status === "inactive")
					await client.query(
						"UPDATE tenancy.api_keys SET revoked_at=coalesce(revoked_at,clock_timestamp()) WHERE organization_id=$1 AND service_account_id=$2",
						[org, input.id],
					);
				await audit(
					client,
					org,
					actor.userId,
					`service_account.${input.status}`,
					input.id,
				);
				return account;
			});
		},
	};
}

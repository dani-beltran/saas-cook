import { createHash, createHmac, randomBytes, randomUUID } from "node:crypto";
import {
	type AuditQuery,
	auditQuery,
	type IntegrationCommandInput,
	type IntegrationInput,
	integrationCommandInput,
	integrationInput,
	type WebhookInput,
	webhookInput,
} from "@saas-cook/api-contracts/inputs/organization-settings";
import type { Pool, PoolClient } from "pg";
import { privatePayloads } from "../platform/crypto";
import { platformCursors } from "../platform/cursor";
import { ResourceError, type ResourceHooks } from "../resources";
import {
	appendTenantAudit,
	type TenantActor,
	withTenantTransaction,
} from "../tenancy";
import { type EndpointTransport, endpointUrl } from "./network";

const digest = (v: unknown) =>
	createHash("sha256").update(JSON.stringify(v)).digest("hex");
function fresh(a: TenantActor) {
	if (
		Date.now() - a.authenticatedAt.getTime() > 300000 ||
		a.authenticatedAt.getTime() > Date.now()
	)
		throw new ResourceError("DENIED");
}
export function webhookSignature(
	secret: string,
	id: string,
	body: string,
	time: number,
) {
	return `t=${time},v1=${createHmac("sha256", secret).update(`${time}.${id}.${body}`).digest("hex")}`;
}
export function createSettingsService(
	pool: Pool,
	hooks: Pick<ResourceHooks, "authorize">,
	options: {
		secret: string;
		allowedHosts: readonly string[];
		transport: EndpointTransport;
		ready: (c: PoolClient) => Promise<unknown>;
	},
) {
	const crypto = privatePayloads(options.secret),
		cursors = platformCursors(options.secret);
	async function tx<T>(
		a: TenantActor,
		org: string,
		write: boolean,
		work: (c: PoolClient) => Promise<T>,
	) {
		if ("kind" in a || !a.assertCurrent) throw new ResourceError("DENIED");
		if (write) fresh(a);
		return withTenantTransaction(
			pool,
			org,
			[a.userId],
			write,
			async (c) => {
				await hooks.authorize(
					c,
					a,
					org,
					{ type: "organization", id: org },
					"manage",
				);
				return work(c);
			},
			undefined,
			false,
		);
	}
	async function operation<T extends object>(
		c: PoolClient,
		a: TenantActor,
		org: string,
		key: string,
		input: unknown,
		work: () => Promise<T>,
	): Promise<T & { secret?: string | null }> {
		const old = (
			await c.query(
				"SELECT input_hash,result FROM tenancy.settings_operations WHERE organization_id=$1 AND actor_id=$2 AND operation_key=$3",
				[org, a.userId, key],
			)
		).rows[0];
		if (old) {
			if (old.input_hash !== digest(input)) throw new ResourceError("CONFLICT");
			return { ...old.result, secret: null };
		}
		const result = await work();
		const { secret: _, ...safe } = result as T & { secret?: string };
		await c.query(
			"INSERT INTO tenancy.settings_operations(organization_id,actor_id,operation_key,input_hash,result) VALUES($1,$2,$3,$4,$5)",
			[org, a.userId, key, digest(input), JSON.stringify(safe)],
		);
		return result;
	}
	async function auditRows(
		c: PoolClient,
		a: TenantActor,
		org: string,
		limit = 1000,
		cursor?: string,
	) {
		await hooks.authorize(
			c,
			a,
			org,
			{ type: "organization", id: org },
			"manage",
		);
		if (
			!(
				await c.query(
					"SELECT 1 FROM tenancy.audit_access g JOIN tenancy.memberships m ON m.organization_id=g.organization_id AND m.id=g.membership_id WHERE g.organization_id=$1 AND m.user_id=$2 AND g.enabled AND m.status='active'",
					[org, a.userId],
				)
			).rowCount
		)
			throw new ResourceError("DENIED");
		const binding = digest({ kind: "audit", org, actor: a.userId, limit });
		const p = cursor ? cursors.decode(cursor, binding) : null;
		const rows = (
			await c.query<{
				id: string;
				actor_id: string;
				action: string;
				target_id: string;
				occurred_at: Date;
				stamp: string;
				request_id: string | null;
			}>(
				"SELECT id,actor_id,action,target_id,occurred_at,to_char(occurred_at AT TIME ZONE 'UTC','YYYY-MM-DD\"T\"HH24:MI:SS.US\"Z\"') AS stamp,request_id FROM tenancy.audit_events WHERE organization_id=$1 AND ($2::timestamptz IS NULL OR (occurred_at,id)<($2,$3::uuid)) ORDER BY occurred_at DESC,id DESC LIMIT $4",
				[org, p?.value ?? null, p?.id ?? null, limit + 1],
			)
		).rows;
		const page = rows.slice(0, limit),
			last = page.at(-1);
		return {
			items: page.map((r) => ({
				id: r.id,
				actor: r.actor_id,
				action: r.action,
				targetId: r.target_id,
				occurredAt: r.occurred_at.toISOString(),
				requestId: r.request_id,
			})),
			nextCursor:
				rows.length > limit && last
					? cursors.encode(binding, { id: last.id, value: last.stamp })
					: null,
		};
	}
	return {
		async webhooks(a: TenantActor, org: string) {
			return tx(
				a,
				org,
				false,
				async (c) =>
					(
						await c.query(
							"SELECT id,name,url,events,state,version FROM tenancy.webhook_endpoints WHERE organization_id=$1 ORDER BY created_at LIMIT 10",
							[org],
						)
					).rows as {
						id: string;
						name: string;
						url: string;
						events: string[];
						state: string;
						version: number;
					}[],
			);
		},
		async addWebhook(a: TenantActor, org: string, raw: WebhookInput) {
			const i = webhookInput.parse(raw);
			endpointUrl(i.url, options.allowedHosts);
			return tx(a, org, true, (c) =>
				operation(
					c,
					a,
					org,
					i.operationKey,
					{ type: "webhook", ...i },
					async () => {
						if (
							(
								await c.query(
									"SELECT count(*)::int AS n FROM tenancy.webhook_endpoints WHERE organization_id=$1",
									[org],
								)
							).rows[0].n >= 10
						)
							throw new ResourceError("CAPACITY");
						const id = randomUUID(),
							secret = randomBytes(32).toString("base64url");
						await c.query(
							"INSERT INTO tenancy.webhook_endpoints(id,organization_id,name,url,events,secret) VALUES($1,$2,$3,$4,$5,$6)",
							[
								id,
								org,
								i.name,
								i.url,
								JSON.stringify([...new Set(i.events)]),
								crypto.seal(secret, `${org}:${id}`),
							],
						);
						await appendTenantAudit(
							c,
							org,
							a.userId,
							"webhook.created",
							id,
							{},
							undefined,
						);
						return { id, version: 1, secret };
					},
				),
			);
		},
		async webhookCommand(
			a: TenantActor,
			org: string,
			input: {
				id: string;
				version: number;
				operationKey: string;
				action: "verify" | "rotate" | "revoke";
			},
		) {
			return tx(a, org, true, (c) =>
				operation(c, a, org, input.operationKey, input, async () => {
					const r = (
						await c.query(
							"SELECT * FROM tenancy.webhook_endpoints WHERE organization_id=$1 AND id=$2 FOR UPDATE",
							[org, input.id],
						)
					).rows[0];
					if (!r || r.version !== input.version || r.state === "revoked")
						throw new ResourceError("CONFLICT");
					let secret: string | null = null;
					if (input.action === "verify") {
						const challenge = randomBytes(24).toString("base64url"),
							body = JSON.stringify({
								version: 1,
								type: "endpoint.verify",
								id: r.id,
								challenge,
							});
						const result = await options.transport(r.url, body, {
							"x-saas-delivery": r.id,
							"x-saas-signature": webhookSignature(
								crypto.open(r.secret, `${org}:${r.id}`),
								r.id,
								body,
								Math.floor(Date.now() / 1000),
							),
						});
						if (
							result.status < 200 ||
							result.status >= 300 ||
							JSON.parse(result.body)?.challenge !== challenge
						)
							throw new ResourceError("INVALID");
						await c.query(
							"UPDATE tenancy.webhook_endpoints SET state='active',version=version+1 WHERE organization_id=$1 AND id=$2",
							[org, r.id],
						);
					} else if (input.action === "rotate") {
						secret = randomBytes(32).toString("base64url");
						await c.query(
							"UPDATE tenancy.webhook_endpoints SET previous_secret=secret,previous_until=clock_timestamp()+interval '24 hours',secret=$3,version=version+1 WHERE organization_id=$1 AND id=$2",
							[org, r.id, crypto.seal(secret, `${org}:${r.id}`)],
						);
					} else {
						await c.query(
							"UPDATE tenancy.webhook_endpoints SET state='revoked',secret=NULL,previous_secret=NULL,version=version+1 WHERE organization_id=$1 AND id=$2",
							[org, r.id],
						);
						await c.query(
							"UPDATE tenancy.webhook_deliveries SET state='canceled' WHERE organization_id=$1 AND endpoint_id=$2 AND state='pending'",
							[org, r.id],
						);
					}
					await appendTenantAudit(
						c,
						org,
						a.userId,
						`webhook.${input.action}`,
						r.id,
						{},
						undefined,
					);
					return { id: r.id as string, version: r.version + 1, secret };
				}),
			);
		},
		async deliveries(a: TenantActor, org: string, endpointId: string) {
			return tx(a, org, false, async (c) =>
				(
					await c.query(
						'SELECT id,event,state,attempts,last_status AS "lastStatus",occurred_at AS "occurredAt" FROM tenancy.webhook_deliveries WHERE organization_id=$1 AND endpoint_id=$2 ORDER BY occurred_at DESC LIMIT 50',
						[org, endpointId],
					)
				).rows.map((r) => ({ ...r, occurredAt: r.occurredAt.toISOString() })),
			);
		},
		async integrations(a: TenantActor, org: string) {
			return tx(a, org, false, async (c) =>
				(
					await c.query(
						"SELECT id,name,provider,url,scopes,state,version,checked_at FROM tenancy.integration_connections WHERE organization_id=$1 ORDER BY id LIMIT 10",
						[org],
					)
				).rows.map((r) => ({
					id: r.id as string,
					name: r.name as string,
					provider: "https-api" as const,
					url: r.url as string,
					scopes: r.scopes as string[],
					state: r.state as string,
					version: r.version as number,
					checkedAt: r.checked_at?.toISOString() ?? null,
				})),
			);
		},
		async addIntegration(a: TenantActor, org: string, raw: IntegrationInput) {
			const i = integrationInput.parse(raw);
			endpointUrl(i.url, options.allowedHosts);
			return tx(a, org, true, (c) =>
				operation(
					c,
					a,
					org,
					i.operationKey,
					{ type: "integration", ...i, token: digest(i.token) },
					async () => {
						if (
							(
								await c.query(
									"SELECT count(*)::int AS n FROM tenancy.integration_connections WHERE organization_id=$1",
									[org],
								)
							).rows[0].n >= 10
						)
							throw new ResourceError("CAPACITY");
						const id = randomUUID();
						await c.query(
							"INSERT INTO tenancy.integration_connections(id,organization_id,name,url,scopes,secret) VALUES($1,$2,$3,$4,$5,$6)",
							[
								id,
								org,
								i.name,
								i.url,
								JSON.stringify(i.scopes),
								crypto.seal(i.token, `${org}:${id}`),
							],
						);
						await appendTenantAudit(
							c,
							org,
							a.userId,
							"integration.created",
							id,
							{ provider: "https-api" },
							undefined,
						);
						return { id, version: 1 };
					},
				),
			);
		},
		async integrationCommand(
			a: TenantActor,
			org: string,
			input: IntegrationCommandInput,
		) {
			if (!integrationCommandInput.safeParse(input).success)
				throw new ResourceError("INVALID");
			return tx(a, org, true, (c) =>
				operation(
					c,
					a,
					org,
					input.operationKey,
					{ ...input, token: input.token ? digest(input.token) : undefined },
					async () => {
						const r = (
							await c.query(
								"SELECT * FROM tenancy.integration_connections WHERE organization_id=$1 AND id=$2 FOR UPDATE",
								[org, input.id],
							)
						).rows[0];
						if (!r || r.version !== input.version || r.state === "revoked")
							throw new ResourceError("CONFLICT");
						let state = "unverified";
						if (input.action === "check") {
							const response = await options.transport(
								r.url,
								JSON.stringify({
									version: 1,
									type: "connection.health",
									scopes: r.scopes,
								}),
								{
									authorization: `Bearer ${crypto.open(r.secret, `${org}:${r.id}`)}`,
								},
							);
							state =
								response.status >= 200 && response.status < 300
									? "active"
									: "unhealthy";
							await c.query(
								"UPDATE tenancy.integration_connections SET state=$3,checked_at=clock_timestamp(),version=version+1 WHERE organization_id=$1 AND id=$2",
								[org, r.id, state],
							);
						} else {
							state = input.action === "revoke" ? "revoked" : "unverified";
							await c.query(
								"UPDATE tenancy.integration_connections SET secret=$3,state=$4,version=version+1 WHERE organization_id=$1 AND id=$2",
								[
									org,
									r.id,
									input.action === "rotate"
										? crypto.seal(input.token ?? "", `${org}:${r.id}`)
										: null,
									state,
								],
							);
						}
						await appendTenantAudit(
							c,
							org,
							a.userId,
							`integration.${input.action}`,
							r.id,
							{ provider: "https-api" },
							undefined,
						);
						return { id: r.id as string, version: r.version + 1, state };
					},
				),
			);
		},
		async auditGrants(a: TenantActor, org: string) {
			return tx(
				a,
				org,
				false,
				async (c) =>
					(
						await c.query(
							"SELECT m.id AS \"membershipId\",m.role,coalesce(g.enabled,false) AS enabled,coalesce(g.version,0) AS version FROM tenancy.memberships m LEFT JOIN tenancy.audit_access g ON g.organization_id=m.organization_id AND g.membership_id=m.id WHERE m.organization_id=$1 AND m.status='active' AND m.role IN ('owner','admin') ORDER BY m.id LIMIT 100",
							[org],
						)
					).rows,
			);
		},
		async grantAudit(
			a: TenantActor,
			org: string,
			input: {
				membershipId: string;
				enabled: boolean;
				version: number;
				operationKey: string;
			},
		) {
			return tx(a, org, true, (c) =>
				operation(c, a, org, input.operationKey, input, async () => {
					if (
						!(
							await c.query(
								"SELECT 1 FROM tenancy.memberships WHERE organization_id=$1 AND user_id=$2 AND role='owner' AND status='active'",
								[org, a.userId],
							)
						).rowCount
					)
						throw new ResourceError("DENIED");
					const member = (
						await c.query(
							"SELECT role FROM tenancy.memberships WHERE organization_id=$1 AND id=$2 AND status='active'",
							[org, input.membershipId],
						)
					).rows[0];
					if (!member || !["owner", "admin"].includes(member.role))
						throw new ResourceError("INVALID");
					const row = (
						await c.query(
							"INSERT INTO tenancy.audit_access(organization_id,membership_id,enabled) SELECT $1,$2,$3 WHERE $4=0 OR EXISTS(SELECT 1 FROM tenancy.audit_access WHERE organization_id=$1 AND membership_id=$2 AND version=$4) ON CONFLICT(organization_id,membership_id) DO UPDATE SET enabled=$3,version=audit_access.version+1 WHERE audit_access.version=$4 RETURNING version",
							[org, input.membershipId, input.enabled, input.version],
						)
					).rows[0];
					if (!row) throw new ResourceError("CONFLICT");
					await appendTenantAudit(
						c,
						org,
						a.userId,
						"audit.access_changed",
						input.membershipId,
						{ enabled: input.enabled },
						undefined,
					);
					return { version: row.version as number };
				}),
			);
		},
		async audit(a: TenantActor, org: string, input: AuditQuery) {
			const parsed = auditQuery.safeParse(input);
			if (!parsed.success) throw new ResourceError("INVALID");
			const { limit = 30, cursor } = parsed.data;
			return tx(a, org, false, async (c) => {
				const rows = await auditRows(c, a, org, limit, cursor);
				await appendTenantAudit(
					c,
					org,
					a.userId,
					"audit.queried",
					org,
					{},
					undefined,
				);
				return rows;
			});
		},
		async auditExport(c: PoolClient, a: TenantActor, org: string) {
			const r = await auditRows(c, a, org);
			if (r.nextCursor) throw new ResourceError("CAPACITY");
			return r.items;
		},
		async deliverWebhooks(org: string) {
			return withTenantTransaction(
				pool,
				org,
				[],
				false,
				async (c) => {
					await options.ready(c);
					if (
						!(
							await c.query(
								"SELECT 1 FROM tenancy.organizations WHERE id=$1 AND status='active'",
								[org],
							)
						).rowCount
					)
						return;
					const rows = (
						await c.query(
							"SELECT d.*,e.url,e.secret,e.previous_secret,e.previous_until,e.state AS endpoint_state FROM tenancy.webhook_deliveries d JOIN tenancy.webhook_endpoints e ON e.organization_id=d.organization_id AND e.id=d.endpoint_id WHERE d.organization_id=$1 AND d.state='pending' AND d.available_at<=clock_timestamp() ORDER BY d.available_at LIMIT 5 FOR UPDATE OF d SKIP LOCKED",
							[org],
						)
					).rows;
					for (const r of rows) {
						if (r.endpoint_state !== "active" || !r.secret) {
							await c.query(
								"UPDATE tenancy.webhook_deliveries SET state='canceled' WHERE organization_id=$1 AND id=$2",
								[org, r.id],
							);
							continue;
						}
						const body = JSON.stringify({
								version: 1,
								id: r.source_id,
								type: r.event,
								organizationId: org,
								targetId: r.target_id,
								occurredAt: r.occurred_at.toISOString(),
							}),
							time = Math.floor(Date.now() / 1000);
						let signature = webhookSignature(
							crypto.open(r.secret, `${org}:${r.endpoint_id}`),
							r.id,
							body,
							time,
						);
						if (r.previous_secret && r.previous_until > new Date())
							signature += `,previous=${webhookSignature(crypto.open(r.previous_secret, `${org}:${r.endpoint_id}`), r.id, body, time).split("v1=")[1]}`;
						let status = 0;
						try {
							status = (
								await options.transport(r.url, body, {
									"x-saas-delivery": r.id,
									"x-saas-signature": signature,
								})
							).status;
						} catch {}
						await options.ready(c);
						await c.query(
							"UPDATE tenancy.webhook_deliveries SET state=$3,attempts=attempts+1,last_status=$4,available_at=clock_timestamp()+($5::int * interval '1 second') WHERE organization_id=$1 AND id=$2",
							[
								org,
								r.id,
								status >= 200 && status < 300
									? "delivered"
									: r.attempts >= 7
										? "failed"
										: "pending",
								status || null,
								Math.min(
									3600,
									2 ** (r.attempts + 1) * 15 + Math.floor(Math.random() * 10),
								),
							],
						);
					}
				},
				undefined,
				false,
			);
		},
	};
}

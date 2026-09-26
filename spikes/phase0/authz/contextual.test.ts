import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { ContextualAuthority, ContextualPolicy } from "./contextual.js";
import {
	fixtureTuples,
	qualifyObject,
	qualifyTuples,
	type Tuple,
} from "./model.js";
import { OpenFgaGraph, PostgresAuthority } from "./postgres.js";
import { bounded } from "./protocol.js";

const enabled = process.env.PHASE0_INTEGRATION === "1";
describe.skipIf(!enabled)(
	"authoritative request-local contexts with real PostgreSQL/OpenFGA",
	() => {
		const database =
			process.env.AUTHZ_DATABASE_URL ??
			"postgresql://postgres:phase0@127.0.0.1:55432/phase0_authz";
		const prefix = `context-${randomUUID()}`;
		let authority: ContextualAuthority;
		let graph: OpenFgaGraph;
		let model: string;
		let policy: ContextualPolicy;
		const recoveryTimings: Record<string, number> = {};
		beforeAll(async () => {
			authority = new ContextualAuthority(database);
			await authority.install();
			({ graph, model } = await OpenFgaGraph.create(
				process.env.OPENFGA_URL ?? "http://127.0.0.1:18080",
			));
			policy = new ContextualPolicy(graph, model);
		});
		afterAll(async () => {
			await authority.pool.end();
			await mkdir("artifacts/phase0", { recursive: true });
			await writeFile(
				"artifacts/phase0/authz-contextual-fault-timings.json",
				`${JSON.stringify(
					{
						capturedAt: new Date().toISOString(),
						recoveryBudgetMs: 30_000,
						timingsMs: recoveryTimings,
						note: "Fresh authorized request after a fixture dependency returns; not disaster recovery or independent security revalidation.",
					},
					null,
					2,
				)}\n`,
			);
		});
		async function fixture(
			name: string,
			extra: (org: string) => Tuple[] = () => [],
		) {
			const org = `${prefix}-${name}`;
			await authority.seed(
				org,
				model,
				[...fixtureTuples(org, 6), ...extra(org)],
				randomUUID(),
			);
			return org;
		}
		const read = (
			org: string,
			actor = `user:${org}-u1`,
			object = "project:r000000",
			evaluator = policy,
		) =>
			authority.transaction(
				org,
				false,
				async (client, revision) =>
					(await evaluator.check(client, revision, actor, [object]))[0],
				actor,
			);
		const revoke = (org: string) =>
			authority.change(org, async (client) => {
				await client.query(
					"DELETE FROM phase0_authz.source_tuples WHERE organization=$1 AND tuple->>'user'=$2 AND tuple->>'relation'='viewer'",
					[org, `user:${org}-u1`],
				);
			});

		it.each(["revocation", "expiry", "membership", "epoch", "unrelated"])(
			"revalidates a preflight decision before mutation: %s",
			async (race) => {
				const expiresAt = new Date(Date.now() + 600).toISOString();
				const org = await fixture(`preflight-${race}`, (org) => [
					{
						user: `user:${org}-u3`,
						relation: "viewer",
						object: "project:r000001",
						...(race === "expiry"
							? {
									condition: {
										name: "before_expiry",
										context: { expires_at: expiresAt },
									},
								}
							: {}),
					},
				]);
				const original = authority.change.bind(authority);
				const before = policy.checks;
				const hook = vi
					.spyOn(authority, "change")
					.mockImplementationOnce(async (organization, fn, actor, start) => {
						if (race === "expiry") {
							await authority.pool.query(
								"SELECT pg_sleep(GREATEST(0,EXTRACT(EPOCH FROM ($1::timestamptz-clock_timestamp())))+0.02)",
								[expiresAt],
							);
						} else {
							await original(org, async (client) => {
								if (race === "revocation")
									await client.query(
										"DELETE FROM phase0_authz.source_tuples WHERE organization=$1 AND tuple->>'user'=$2",
										[org, `user:${org}-u3`],
									);
								if (race === "membership")
									await client.query(
										"UPDATE phase0_authz.memberships SET active=false WHERE organization=$1 AND actor=$2",
										[org, `user:${org}-u3`],
									);
								if (race === "epoch")
									await client.query(
										"UPDATE phase0_authz.tenants SET epoch=$2 WHERE organization=$1",
										[org, randomUUID()],
									);
							});
						}
						return original(organization, fn, actor, start);
					});
				let mutated = false;
				try {
					const operation = policy.change(
						authority,
						org,
						`user:${org}-u3`,
						"project:r000001",
						async () => {
							mutated = true;
						},
						"can_read",
					);
					if (["revocation", "expiry", "membership"].includes(race)) {
						await expect(operation).rejects.toThrow();
						expect(mutated).toBe(false);
					} else {
						await operation;
						expect(mutated).toBe(true);
						expect(policy.checks - before).toBe(race === "epoch" ? 2 : 1);
					}
					expect(hook).toHaveBeenCalledOnce();
				} finally {
					hook.mockRestore();
				}
			},
		);

		it("matches stored-model decisions for admins, sparse grants, teams, inheritance and conditions", async () => {
			const org = await fixture("parity", (org) => [
				{ user: "workspace:a", relation: "parent", object: "project:r000002" },
				{
					user: `user:${org}-u3`,
					relation: "viewer",
					object: "project:r000001",
					condition: {
						name: "before_expiry",
						context: { expires_at: "2000-01-01T00:00:00Z" },
					},
				},
				{
					user: `user:${org}-u4`,
					relation: "viewer",
					object: "project:r000001",
					condition: {
						name: "before_expiry",
						context: { expires_at: "2100-01-01T00:00:00Z" },
					},
				},
				{
					user: "team:editors#member",
					relation: "manager",
					object: "project:r000003",
				},
			]);
			const baseline = {
				organization: org,
				epoch: randomUUID(),
				generation: randomUUID(),
			};
			const rows = await authority.pool.query<{ tuple: Tuple }>(
				"SELECT tuple FROM phase0_authz.source_tuples WHERE organization=$1 ORDER BY id",
				[org],
			);
			const tuples = qualifyTuples(
				rows.rows.map((r) => r.tuple),
				baseline,
			);
			for (let offset = 0; offset < tuples.length; offset += 100)
				await graph.write(tuples.slice(offset, offset + 100), model);
			const writes = graph.writeCalls;
			for (let principal = 0; principal < 6; principal++) {
				const actor = `user:${org}-u${principal}`;
				for (const permission of ["can_read", "can_manage"]) {
					const objects = [
						"project:r000000",
						"project:r000001",
						"project:r000002",
						"project:r000003",
						"project:missing",
					];
					const actual = await authority.transaction(
						org,
						false,
						(client, revision) =>
							policy.check(client, revision, actor, objects, permission),
						actor,
					);
					const expected = await Promise.all(
						objects.map((object) =>
							graph.check(
								actor,
								permission,
								qualifyObject(object, baseline),
								model,
							),
						),
					);
					expect(actual).toEqual(expected);
				}
			}
			expect(graph.writeCalls).toBe(writes);
			expect(await read(org, `user:${org}-u2`, "project:r000002")).toBe(true);
			expect(await read(org, `user:${org}-u3`, "project:r000001")).toBe(false);
			expect(await read(org, `user:${org}-u4`, "project:r000001")).toBe(true);
		});

		it("publishes source changes at commit, with immediate create-read and no projection artifacts", async () => {
			const org = await fixture("commit");
			const writes = graph.writeCalls;
			await revoke(org);
			expect(await read(org)).toBe(false);
			await authority.change(org, async (client) => {
				await client.query(
					"INSERT INTO phase0_authz.resources (organization,object) VALUES ($1,'project:new')",
					[org],
				);
				for (const tuple of [
					{
						user: "organization:root",
						relation: "organization",
						object: "project:new",
					},
					{
						user: `user:${org}-u1`,
						relation: "manager",
						object: "project:new",
					},
				])
					await client.query(
						"INSERT INTO phase0_authz.source_tuples (organization,tuple) VALUES ($1,$2)",
						[org, tuple],
					);
			});
			expect(await read(org, undefined, "project:new")).toBe(true);
			const rows = await authority.pool.query(
				"SELECT desired=applied AS ready,(SELECT count(*) FROM phase0_authz.attempts WHERE organization=$1) AS attempts FROM phase0_authz.tenants WHERE organization=$1",
				[org],
			);
			expect(rows.rows[0]).toMatchObject({ ready: true, attempts: "0" });
			expect(graph.writeCalls).toBe(writes);
			const legacy = new PostgresAuthority(database);
			try {
				await expect(legacy.prepare(org, randomUUID())).rejects.toThrow(
					"policy_mismatch",
				);
			} finally {
				await legacy.pool.end();
			}
		});

		it("ignores delayed persistent writes into a previous request namespace", async () => {
			const org = await fixture("late-write");
			let oldTuples: Tuple[] = [];
			class CapturingGraph extends OpenFgaGraph {
				override async request<T>(path: string, body: unknown): Promise<T> {
					if (path.endsWith("/batch-check"))
						oldTuples = (
							body as {
								checks: { contextual_tuples: { tuple_keys: Tuple[] } }[];
							}
						).checks[0].contextual_tuples.tuple_keys;
					if (path.endsWith("/check"))
						oldTuples = (body as { contextual_tuples: { tuple_keys: Tuple[] } })
							.contextual_tuples.tuple_keys;
					return super.request<T>(path, body);
				}
			}
			const capture = new ContextualPolicy(
				new CapturingGraph(graph.url, graph.store),
				model,
			);
			expect(await read(org, undefined, undefined, capture)).toBe(true);
			expect(oldTuples.length).toBeGreaterThan(0);
			const stored = await graph.request<{ tuples: unknown[] }>(
				`/stores/${graph.store}/read`,
				{
					tuple_key: {
						object: oldTuples.find((t) => t.object.startsWith("project:"))
							?.object,
					},
				},
			);
			expect(stored.tuples).toEqual([]);
			await revoke(org);
			await graph.write(oldTuples, model); // Complete an old remote effect after revocation.
			expect(await read(org)).toBe(false);
			expect(await read(org, `user:${org}-u0`)).toBe(true);
		});

		it("a late allowed response after lock-bearing connection loss cannot commit a protected write", async () => {
			const org = await fixture("connection-loss");
			let release!: () => void;
			let received!: () => void;
			let pid = 0;
			const held = new Promise<void>((r) => {
				release = r;
			});
			const accepted = new Promise<void>((r) => {
				received = r;
			});
			class DelayedGraph extends OpenFgaGraph {
				override async request<T>(path: string, body: unknown): Promise<T> {
					const result = await super.request<T>(path, body);
					if (path.endsWith("/batch-check") || path.endsWith("/check")) {
						received();
						await held;
					}
					return result;
				}
			}
			const delayed = new ContextualPolicy(
				new DelayedGraph(graph.url, graph.store),
				model,
			);
			const old = authority.transaction(
				org,
				false,
				async (client, revision) => {
					client.on("error", () => undefined);
					pid = (await client.query("SELECT pg_backend_pid() AS pid")).rows[0]
						.pid;
					if (
						(
							await delayed.check(client, revision, `user:${org}-u1`, [
								"project:r000000",
							])
						)[0]
					)
						await client.query(
							"UPDATE phase0_authz.resources SET version=version+1 WHERE organization=$1",
							[org],
						);
				},
				`user:${org}-u1`,
			);
			const outcome = old.then(
				() => undefined,
				(error: unknown) => error,
			);
			try {
				await bounded(accepted, 1_000);
				await authority.pool.query("SELECT pg_terminate_backend($1)", [pid]);
				await revoke(org);
			} finally {
				release();
			}
			expect(await outcome).toBeInstanceOf(Error);
			const recoveredAt = performance.now();
			expect(await bounded(read(org, `user:${org}-u0`), 30_000)).toBe(true);
			recoveryTimings.connectionLoss = performance.now() - recoveredAt;
			expect(recoveryTimings.connectionLoss).toBeLessThan(30_000);
			expect(await read(org)).toBe(false);
			expect(
				(
					await authority.pool.query(
						"SELECT max(version) AS version FROM phase0_authz.resources WHERE organization=$1",
						[org],
					)
				).rows[0].version,
			).toBe(1);
		});

		it("a real HTTP timeout cannot authorize a mutation and a restored endpoint recovers", async () => {
			const org = await fixture("http-timeout");
			const server = createServer((_request, _response) => {
				/* Deliberately withhold the response. */
			});
			await new Promise<void>((resolve) =>
				server.listen(0, "127.0.0.1", resolve),
			);
			const port = (server.address() as AddressInfo).port;
			const stalled = new ContextualPolicy(
				new OpenFgaGraph(`http://127.0.0.1:${port}`, graph.store, 50),
				model,
			);
			let mutated = false;
			try {
				await expect(
					stalled.change(
						authority,
						org,
						`user:${org}-u0`,
						"project:r000000",
						async () => {
							mutated = true;
						},
					),
				).rejects.toThrow();
				expect(mutated).toBe(false);
			} finally {
				server.closeAllConnections();
				await new Promise<void>((resolve, reject) =>
					server.close((error) => (error ? reject(error) : resolve())),
				);
			}
			const recoveredAt = performance.now();
			expect(await bounded(read(org, `user:${org}-u0`), 30_000)).toBe(true);
			recoveryTimings.timeout = performance.now() - recoveredAt;
			expect(recoveryTimings.timeout).toBeLessThan(30_000);
		});

		it("denies graph outages, inactive/expired memberships and unrevalidated recovery or model changes", async () => {
			const org = await fixture("gates");
			const outage = new ContextualPolicy(
				new OpenFgaGraph("http://127.0.0.1:1", graph.store, 50),
				model,
			);
			await expect(read(org, undefined, undefined, outage)).rejects.toThrow();
			await revoke(org); // Local authority remains available during a graph outage.
			const recoveredAt = performance.now();
			expect(await bounded(read(org, `user:${org}-u0`), 30_000)).toBe(true);
			recoveryTimings.outage = performance.now() - recoveredAt;
			expect(recoveryTimings.outage).toBeLessThan(30_000);
			expect(await read(org)).toBe(false);
			await authority.change(org, async (client) => {
				await client.query(
					"UPDATE phase0_authz.memberships SET active=false WHERE organization=$1 AND actor=$2",
					[org, `user:${org}-u1`],
				);
			});
			await expect(read(org)).rejects.toThrow("not_eligible");
			await authority.pool.query(
				"UPDATE phase0_authz.memberships SET active=true,expires_at=now()-interval '1 second' WHERE organization=$1 AND actor=$2",
				[org, `user:${org}-u1`],
			);
			await expect(read(org)).rejects.toThrow("not_eligible");
			await authority.transaction(org, true, async (client) => {
				await client.query(
					"UPDATE phase0_authz.tenants SET epoch=$2,ready=false WHERE organization=$1",
					[org, randomUUID()],
				);
			});
			await expect(read(org, `user:${org}-u0`)).rejects.toThrow(
				"recovery_pending",
			);
			await authority.pool.query(
				"UPDATE phase0_authz.tenants SET ready=true,model='unvalidated-model' WHERE organization=$1",
				[org],
			);
			await expect(read(org, `user:${org}-u0`)).rejects.toThrow(
				"policy_mismatch",
			);
		});

		it("fails closed on oversized contexts and rolls back failed source changes", async () => {
			const org = await fixture("bounds", (org) =>
				Array.from({ length: 55 }, (_, i) => [
					{
						user: `team:t${i}#member`,
						relation: "viewer",
						object: "project:r000001",
					},
					{ user: `user:${org}-u1`, relation: "member", object: `team:t${i}` },
				]).flat(),
			);
			await expect(read(org, undefined, "project:r000001")).rejects.toThrow(
				"context_limit",
			);
			await expect(
				authority.change(org, async (client) => {
					await client.query(
						"DELETE FROM phase0_authz.source_tuples WHERE organization=$1",
						[org],
					);
					throw new Error("rollback");
				}),
			).rejects.toThrow("rollback");
			expect(await read(org)).toBe(true);
			await expect(read(org, `user:${prefix}-different-u1`)).rejects.toThrow(
				"not_eligible",
			);
		});
	},
);

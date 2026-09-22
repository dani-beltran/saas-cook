import { randomUUID } from "node:crypto";
import { once } from "node:events";
import { mkdir, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
	authorizationModel,
	fixtureTuples,
	qualifyObject,
	type Tuple,
} from "./model.js";
import { OpenFgaGraph, PostgresAuthority } from "./postgres.js";
import { checkAt, type Graph, project } from "./protocol.js";

const enabled =
	process.env.PHASE0_INTEGRATION === "1" ||
	Boolean(process.env.AUTHZ_DATABASE_URL && process.env.OPENFGA_URL);
describe.skipIf(!enabled)("PostgreSQL/OpenFGA generation fault suite", () => {
	let authority: PostgresAuthority;
	let graph: OpenFgaGraph;
	let model: string;
	const prefix = `fault-${randomUUID()}`;
	const timings: Record<string, number> = {};
	beforeAll(async () => {
		authority = new PostgresAuthority(
			process.env.AUTHZ_DATABASE_URL ??
				"postgresql://postgres:phase0@127.0.0.1:55432/phase0_authz",
		);
		await authority.install();
		({ graph, model } = await OpenFgaGraph.create(
			process.env.OPENFGA_URL ?? "http://127.0.0.1:18080",
		));
	});
	afterAll(async () => {
		await mkdir("artifacts/phase0", { recursive: true });
		await writeFile(
			"artifacts/phase0/authz-fault-timings.json",
			JSON.stringify(
				{
					measuredAt: new Date().toISOString(),
					backend:
						"real PostgreSQL/OpenFGA with deterministic HTTP delay proxy",
					recoveryBudgetMs: 30_000,
					timingsMs: timings,
					scope:
						"Projection and epoch fence only; not an independent recovery-store or complete restore drill.",
				},
				null,
				2,
			),
		);
		await authority?.pool.end();
	});
	async function fixture(name: string) {
		const organization = `${prefix}-${name}`;
		await authority.seed(
			organization,
			model,
			fixtureTuples(organization, 3),
			randomUUID(),
		);
		return organization;
	}
	const read = (
		organization: string,
		user: string,
		object = "project:r000000",
	) =>
		authority.transaction(
			organization,
			false,
			(_client, revision) => checkAt(graph, revision, user, object),
			user,
		);
	const revoke = (organization: string) =>
		authority.change(organization, async (client) => {
			await client.query(
				"DELETE FROM phase0_authz.source_tuples WHERE organization=$1 AND tuple->>'user'=$2 AND tuple->>'relation'='viewer'",
				[organization, `user:${organization}-u1`],
			);
		});

	async function delayedWriter() {
		let release!: () => void;
		let accepted!: () => void;
		const held = new Promise<void>((resolve) => {
			release = resolve;
		});
		const received = new Promise<void>((resolve) => {
			accepted = resolve;
		});
		const server = createServer(async (request, response) => {
			const chunks: Buffer[] = [];
			for await (const chunk of request) chunks.push(Buffer.from(chunk));
			accepted(); // The old remote request has actually left the worker.
			await held;
			try {
				const result = await fetch(`${graph.url}${request.url}`, {
					method: "POST",
					headers: { "content-type": "application/json" },
					body: Buffer.concat(chunks),
					signal: AbortSignal.timeout(5_000),
				});
				response.writeHead(result.status, {
					"content-type": "application/json",
				});
				response.end(await result.text());
			} catch {
				response.writeHead(502);
				response.end();
			}
		});
		server.listen(0, "127.0.0.1");
		await once(server, "listening");
		const address = server.address();
		if (!address || typeof address === "string")
			throw new Error("Missing fault proxy address");
		return {
			writer: new OpenFgaGraph(
				`http://127.0.0.1:${address.port}`,
				graph.store,
				5_000,
			),
			received,
			release,
			close: () => {
				server.closeAllConnections();
				server.close();
			},
		};
	}

	it("old remote request completes after lost PostgreSQL connection, N replay and N+1 revocation", async () => {
		const organization = await fixture("late");
		const old = await authority.prepare(organization, randomUUID());
		// Reproduce the unsafe mutex assumption explicitly: A's connection owns the
		// actual organization fence while its remote write is in flight.
		const connection = await authority.pool.connect();
		await connection.query("BEGIN");
		await connection.query(
			"SELECT pg_advisory_xact_lock(hashtextextended($1,0))",
			[`phase0:org:${organization}`],
		);
		const proxy = await delayedWriter();
		const late = proxy.writer.write(old.tuples, model);
		await proxy.received;
		// Kill a real projector DB connection; remote work is intentionally independent.
		const pid = (
			await connection.query<{ pid: number }>("SELECT pg_backend_pid() AS pid")
		).rows[0]?.pid;
		if (!pid) throw new Error("Missing projector backend PID");
		connection.on("error", () => undefined);
		await authority.pool.query("SELECT pg_terminate_backend($1)", [pid]);
		await expect(connection.query("SELECT 1")).rejects.toThrow();
		connection.release(true);
		const start = performance.now();
		await project(authority, graph, organization); // Replacement atomically abandons A before writing B.
		expect(await read(organization, `user:${organization}-u1`)).toBe(true);
		await revoke(organization);
		await expect(read(organization, `user:${organization}-u1`)).rejects.toThrow(
			"projection_pending",
		);
		await project(authority, graph, organization);
		proxy.release();
		await late;
		proxy.close();
		await expect(authority.acknowledge(old)).rejects.toThrow("abandoned");
		expect(await authority.publish(old)).toBe(false);
		expect(await read(organization, `user:${organization}-u1`)).toBe(false);
		expect(
			await graph.check(
				`user:${organization}-u1`,
				"can_read",
				qualifyObject("project:r000000", old),
				model,
			),
		).toBe(true);
		timings.connectionLoss = performance.now() - start;
		expect(timings.connectionLoss).toBeLessThan(30_000);
	});

	it("abandons ambiguous HTTP timeout and refuses its publication after late completion", async () => {
		const organization = await fixture("timeout");
		const proxy = await delayedWriter();
		let completion: Promise<void> | undefined;
		const fault: Graph = {
			write: (tuples, id) => {
				completion = proxy.writer.write(tuples, id);
				return completion;
			},
			check: (...args) => graph.check(...args),
			remove: (...args) => graph.remove(...args),
		};
		await expect(
			project(authority, fault, organization, { timeoutMs: 5 }),
		).rejects.toThrow("remote_timeout");
		const start = performance.now();
		await revoke(organization);
		await project(authority, graph, organization);
		proxy.release();
		await completion;
		proxy.close();
		expect(await read(organization, `user:${organization}-u1`)).toBe(false);
		timings.timeout = performance.now() - start;
		expect(timings.timeout).toBeLessThan(30_000);
	});

	it("writes duplicate identical tuples safely and supersedes concurrent attempt owners", async () => {
		const organization = await fixture("duplicate");
		const a = await authority.prepare(organization, randomUUID());
		await graph.write(a.tuples, model);
		await graph.write(a.tuples, model);
		const b = await authority.prepare(organization, randomUUID());
		await expect(authority.acknowledge(a)).rejects.toThrow();
		await graph.write(b.tuples, model);
		await authority.acknowledge(b);
		expect(await authority.publish(b)).toBe(true);
		expect(await authority.publish(a)).toBe(false);
	});

	it("local deactivation succeeds while the graph endpoint is unavailable", async () => {
		const organization = await fixture("outage");
		await project(authority, graph, organization);
		const unavailable = new OpenFgaGraph("http://127.0.0.1:1", graph.store, 50);
		await authority.change(organization, async (client) => {
			await client.query(
				"UPDATE phase0_authz.memberships SET active=false WHERE organization=$1 AND actor=$2",
				[organization, `user:${organization}-u1`],
			);
			await client.query(
				"DELETE FROM phase0_authz.source_tuples WHERE organization=$1 AND tuple->>'user'=$2",
				[organization, `user:${organization}-u1`],
			);
		});
		await expect(
			project(authority, unavailable, organization),
		).rejects.toThrow();
		await expect(read(organization, `user:${organization}-u1`)).rejects.toThrow(
			"not_eligible",
		);
		await expect(read(organization, `user:${organization}-u0`)).rejects.toThrow(
			"projection_pending",
		);
		const start = performance.now();
		await project(authority, graph, organization);
		expect(await read(organization, `user:${organization}-u0`)).toBe(true);
		expect(performance.now() - start).toBeLessThan(30_000);
		timings.outage = performance.now() - start;
	});

	it("real policy enforces team inheritance, same-tenant membership and expiry", async () => {
		const organization = await fixture("policy");
		const extra: Tuple[] = [
			{ user: "workspace:a", relation: "parent", object: "project:r000001" },
			{
				user: `user:${organization}-u3`,
				relation: "viewer",
				object: "project:r000002",
				condition: {
					name: "before_expiry",
					context: { expires_at: "2000-01-01T00:00:00Z" },
				},
			},
		];
		await authority.change(organization, async (client) => {
			for (const tuple of extra)
				await client.query(
					"INSERT INTO phase0_authz.source_tuples (organization,tuple) VALUES ($1,$2)",
					[organization, tuple],
				);
		});
		await project(authority, graph, organization);
		expect(
			await read(organization, `user:${organization}-u2`, "project:r000001"),
		).toBe(true);
		expect(
			await read(organization, `user:${organization}-u3`, "project:r000002"),
		).toBe(false);
		await expect(read(organization, "user:other-tenant")).rejects.toThrow(
			"not_eligible",
		);
	});

	it("shared readers drain before revocation and later readers cannot overtake it", async () => {
		const organization = await fixture("contention");
		await project(authority, graph, organization);
		let started!: () => void;
		const ready = new Promise<void>((resolve) => {
			started = resolve;
		});
		const held = authority.transaction(organization, false, async (client) => {
			started();
			await client.query("SELECT pg_sleep(0.1)");
		});
		await ready;
		const start = performance.now();
		const mutation = revoke(organization);
		// Wait until PostgreSQL itself confirms the revocation is queued on the lock.
		for (let attempt = 0; attempt < 100; attempt++) {
			const waits = await authority.pool.query<{ count: string }>(
				"SELECT count(*) FROM pg_stat_activity WHERE application_name='phase0-authz' AND wait_event_type='Lock'",
			);
			if (Number(waits.rows[0]?.count) > 0) break;
			await new Promise((resolve) => setTimeout(resolve, 1));
		}
		const reader = read(organization, `user:${organization}-u1`);
		await expect(reader).rejects.toThrow("projection_pending");
		await Promise.all([held, mutation]);
		timings.sparseFence = performance.now() - start;
		expect(timings.sparseFence).toBeLessThan(1_000);
	});

	it("recovery epoch refuses old attempts and revision equality cannot release readiness", async () => {
		const organization = await fixture("recovery");
		const old = await authority.prepare(organization, randomUUID());
		await graph.write(old.tuples, model);
		await authority.acknowledge(old);
		await authority.transaction(organization, true, async (client) => {
			await client.query(
				"UPDATE phase0_authz.tenants SET epoch=$2, ready=false WHERE organization=$1",
				[organization, randomUUID()],
			);
		});
		expect(await authority.publish(old)).toBe(false);
		await project(authority, graph, organization);
		await expect(read(organization, `user:${organization}-u0`)).rejects.toThrow(
			"recovery_pending",
		);
	});

	it("refuses publication under a changed real OpenFGA model ID", async () => {
		const organization = await fixture("model");
		const old = await authority.prepare(organization, randomUUID());
		await graph.write(old.tuples, model);
		await authority.acknowledge(old);
		const replacement = await graph.request<{ authorization_model_id: string }>(
			`/stores/${graph.store}/authorization-models`,
			authorizationModel,
		);
		await authority.transaction(organization, true, async (client) => {
			await client.query(
				"UPDATE phase0_authz.tenants SET model=$2 WHERE organization=$1",
				[organization, replacement.authorization_model_id],
			);
		});
		old.model = replacement.authorization_model_id; // Publication must trust its persisted snapshot metadata.
		expect(await authority.publish(old)).toBe(false);
		expect((await project(authority, graph, organization)).published).toBe(
			true,
		);
		expect(await read(organization, `user:${organization}-u0`)).toBe(true);
	});
});

import { readFile } from "node:fs/promises";
import { Pool, type PoolClient } from "pg";
import { authorizationModel, type Tuple } from "./model.js";
import {
	type Attempt,
	type Authority,
	canPublish,
	type Graph,
	manifest,
	newAttempt,
	type Revision,
	requireReady,
	Unavailable,
} from "./protocol.js";

export const limits = {
	pool: 60,
	projectorPool: 4,
	lockTimeoutMs: 1_000,
	statementTimeoutMs: 5_000,
	remoteTimeoutMs: 1_000,
	attemptLeaseMs: 120_000,
	maxPendingPool: 100,
};

export class OpenFgaGraph implements Graph {
	writeCalls = 0;
	tuplesWritten = 0;
	deleteCalls = 0;
	tuplesDeleted = 0;
	constructor(
		readonly url: string,
		readonly store: string,
		readonly timeoutMs = limits.remoteTimeoutMs,
	) {}
	async request<T>(path: string, body: unknown): Promise<T> {
		const response = await fetch(`${this.url}${path}`, {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify(body),
			signal: AbortSignal.timeout(this.timeoutMs),
		});
		if (!response.ok)
			throw new Error(
				`OpenFGA ${response.status}: ${(await response.text()).slice(0, 400)}`,
			);
		const bodyText = await response.text();
		return (bodyText ? JSON.parse(bodyText) : {}) as T;
	}
	async write(tuples: readonly Tuple[], model: string): Promise<void> {
		await this.request(`/stores/${this.store}/write`, {
			authorization_model_id: model,
			writes: { tuple_keys: tuples, on_duplicate: "ignore" },
		});
		this.writeCalls++;
		this.tuplesWritten += tuples.length;
	}
	async remove(tuples: readonly Tuple[], model: string): Promise<void> {
		await this.request(`/stores/${this.store}/write`, {
			authorization_model_id: model,
			deletes: {
				tuple_keys: tuples.map(({ user, relation, object }) => ({
					user,
					relation,
					object,
				})),
				on_missing: "ignore",
			},
		});
		this.deleteCalls++;
		this.tuplesDeleted += tuples.length;
	}
	async check(
		user: string,
		relation: string,
		object: string,
		model: string,
	): Promise<boolean> {
		const response = await this.request<{ allowed: boolean }>(
			`/stores/${this.store}/check`,
			{
				authorization_model_id: model,
				tuple_key: { user, relation, object },
				consistency: "HIGHER_CONSISTENCY",
				context: { current_time: new Date().toISOString() },
			},
		);
		return response.allowed;
	}
	static async create(
		url: string,
	): Promise<{ graph: OpenFgaGraph; model: string }> {
		const bootstrap = new OpenFgaGraph(url, "", 5_000);
		const store = await bootstrap.request<{ id: string }>("/stores", {
			name: `phase0-${Date.now()}`,
		});
		const graph = new OpenFgaGraph(url, store.id);
		const result = await graph.request<{ authorization_model_id: string }>(
			`/stores/${store.id}/authorization-models`,
			authorizationModel,
		);
		return { graph, model: result.authorization_model_id };
	}
}

interface TenantRow {
	organization: string;
	desired: string;
	applied: string;
	generation: string;
	epoch: string;
	model: string;
	ready: boolean;
}
function toRevision(row: TenantRow): Revision {
	return { ...row, desired: Number(row.desired), applied: Number(row.applied) };
}

export class PostgresAuthority implements Authority {
	readonly pool: Pool;
	readonly fenceWaitMs: number[] = [];
	readonly failedFenceWaitMs: number[] = [];
	readonly poolWaitMs: number[] = [];
	constructor(connectionString: string, max = limits.pool) {
		this.pool = new Pool({
			connectionString,
			max,
			connectionTimeoutMillis: 2_000,
			idleTimeoutMillis: 5_000,
			application_name: "phase0-authz",
		});
	}
	async install(): Promise<void> {
		await this.pool.query(
			await readFile(new URL("./schema.sql", import.meta.url), "utf8"),
		);
	}
	async transaction<T>(
		organization: string,
		exclusive: boolean,
		fn: (client: PoolClient, revision: Revision) => Promise<T>,
		actor?: string,
	): Promise<T> {
		if (this.pool.waitingCount >= limits.maxPendingPool)
			throw new Unavailable("queue_full");
		const poolStarted = performance.now();
		const client = await this.pool.connect();
		this.poolWaitMs.push(performance.now() - poolStarted);
		let fenceStarted: number | undefined;
		let fenceAcquired = false;
		try {
			await client.query("BEGIN");
			await client.query(
				`SET LOCAL lock_timeout = '${limits.lockTimeoutMs}ms'`,
			);
			await client.query(
				`SET LOCAL statement_timeout = '${limits.statementTimeoutMs}ms'`,
			);
			await client.query(
				"SET LOCAL idle_in_transaction_session_timeout = '5000ms'",
			);
			const started = performance.now();
			fenceStarted = started;
			// Canonical lock order: lifecycle user before organization authorization.
			if (actor)
				await client.query(
					"SELECT pg_advisory_xact_lock_shared(hashtextextended($1, 0))",
					[`phase0:user:${actor}`],
				);
			await client.query(
				exclusive
					? "SELECT pg_advisory_xact_lock(hashtextextended($1, 0))"
					: "SELECT pg_advisory_xact_lock_shared(hashtextextended($1, 0))",
				[`phase0:org:${organization}`],
			);
			this.fenceWaitMs.push(performance.now() - started);
			fenceAcquired = true;
			const result = await client.query<TenantRow>(
				"SELECT * FROM phase0_authz.tenants WHERE organization = $1",
				[organization],
			);
			const row = result.rows[0];
			if (!row) throw new Error("Unknown fixture tenant");
			const revision = toRevision(row);
			if (actor) {
				const eligible = await client.query(
					"SELECT 1 FROM phase0_authz.memberships WHERE organization = $1 AND actor = $2 AND active AND (expires_at IS NULL OR expires_at > now())",
					[organization, actor],
				);
				if (eligible.rowCount !== 1) throw new Unavailable("not_eligible");
			}
			const value = await fn(client, revision);
			await client.query("COMMIT");
			return value;
		} catch (error) {
			if (fenceStarted !== undefined && !fenceAcquired)
				this.failedFenceWaitMs.push(performance.now() - fenceStarted);
			await client.query("ROLLBACK").catch(() => undefined);
			if ((error as { code?: string }).code === "55P03")
				throw new Unavailable("lock_timeout");
			throw error;
		} finally {
			client.release();
		}
	}
	async seed(
		organization: string,
		model: string,
		tuples: Tuple[],
		epoch: string,
	): Promise<void> {
		const client = await this.pool.connect();
		try {
			await client.query("BEGIN");
			await client.query(
				"INSERT INTO phase0_authz.tenants (organization, model, epoch) VALUES ($1, $2, $3)",
				[organization, model, epoch],
			);
			await client.query(
				"INSERT INTO phase0_authz.source_tuples (organization, tuple) SELECT $1, value FROM jsonb_array_elements($2::jsonb)",
				[organization, JSON.stringify(tuples)],
			);
			await client.query(
				"INSERT INTO phase0_authz.resources (organization, object) SELECT DISTINCT $1, value->>'object' FROM jsonb_array_elements($2::jsonb) WHERE value->>'object' LIKE 'project:%'",
				[organization, JSON.stringify(tuples)],
			);
			await client.query(
				"INSERT INTO phase0_authz.memberships (organization, actor) SELECT $1, value->>'user' FROM jsonb_array_elements($2::jsonb) WHERE value->>'object' = 'organization:root' AND value->>'relation' = 'member'",
				[organization, JSON.stringify(tuples)],
			);
			await client.query("COMMIT");
		} catch (error) {
			await client.query("ROLLBACK");
			throw error;
		} finally {
			client.release();
		}
	}
	async prepare(organization: string, id: string): Promise<Attempt> {
		return this.transaction(organization, true, async (client, revision) => {
			await client.query(
				"UPDATE phase0_authz.attempts SET state = 'abandoned' WHERE organization = $1 AND state IN ('building', 'verified')",
				[organization],
			);
			const source = await client.query<{ tuple: Tuple }>(
				"SELECT tuple FROM phase0_authz.source_tuples WHERE organization = $1 ORDER BY id",
				[organization],
			);
			const attempt = newAttempt(
				organization,
				id,
				revision,
				source.rows.map((row) => row.tuple),
			);
			await client.query(
				"INSERT INTO phase0_authz.attempts (id, organization, generation, revision, model, epoch, state, tuples, manifest, lease_until) VALUES ($1::text::uuid,$2,$1::text,$3,$4,$5,'building',$6,$7,now() + ($8 * interval '1 millisecond'))",
				[
					id,
					organization,
					attempt.revision,
					attempt.model,
					attempt.epoch,
					JSON.stringify(attempt.tuples),
					attempt.manifest,
					limits.attemptLeaseMs,
				],
			);
			return attempt;
		});
	}
	async acknowledge(attempt: Attempt): Promise<void> {
		if (attempt.manifest !== manifest(attempt.tuples))
			throw new Error("Snapshot changed");
		const result = await this.pool.query(
			"UPDATE phase0_authz.attempts SET state = 'verified', acknowledged_at = now() WHERE id = $1 AND state = 'building' AND manifest = $2 AND lease_until > now()",
			[attempt.id, attempt.manifest],
		);
		if (result.rowCount !== 1) throw new Error("Attempt abandoned or expired");
	}
	async publish(attempt: Attempt): Promise<boolean> {
		return this.transaction(
			attempt.organization,
			true,
			async (client, revision) => {
				const result = await client.query<{
					state: Attempt["state"];
					live: boolean;
					organization: string;
					revision: string;
					model: string;
					epoch: string;
					generation: string;
					manifest: string;
				}>(
					"SELECT state, organization, revision, model, epoch, generation, manifest, lease_until > now() AS live FROM phase0_authz.attempts WHERE id = $1 FOR UPDATE",
					[attempt.id],
				);
				const row = result.rows[0];
				if (
					!row?.live ||
					row.organization !== attempt.organization ||
					row.generation !== attempt.generation ||
					row.manifest !== attempt.manifest ||
					!canPublish(
						{
							...attempt,
							state: row.state,
							revision: Number(row.revision),
							model: row.model,
							epoch: row.epoch,
						},
						revision,
					)
				) {
					await client.query(
						"UPDATE phase0_authz.attempts SET state = 'abandoned' WHERE id = $1 AND state IN ('building','verified')",
						[attempt.id],
					);
					return false;
				}
				await client.query(
					"UPDATE phase0_authz.attempts SET state = 'retired' WHERE organization = $1 AND state = 'active'",
					[attempt.organization],
				);
				await client.query(
					"UPDATE phase0_authz.attempts SET state = 'active', activated_at = now() WHERE id = $1",
					[attempt.id],
				);
				await client.query(
					"UPDATE phase0_authz.tenants SET applied = $2, generation = $3 WHERE organization = $1",
					[row.organization, row.revision, row.generation],
				);
				await client.query(
					"UPDATE phase0_authz.outbox SET applied_at = now() WHERE organization = $1 AND revision <= $2 AND applied_at IS NULL",
					[row.organization, row.revision],
				);
				return true;
			},
		);
	}
	async abandon(attempt: Attempt): Promise<void> {
		await this.pool.query(
			"UPDATE phase0_authz.attempts SET state = 'abandoned' WHERE id = $1 AND state IN ('building','verified')",
			[attempt.id],
		);
	}
	async change<T>(
		organization: string,
		fn: (client: PoolClient, revision: Revision) => Promise<T>,
		actor?: string,
	): Promise<T> {
		return this.transaction(
			organization,
			true,
			async (client, revision) => {
				if (actor) requireReady(revision);
				const value = await fn(client, revision);
				await client.query(
					"UPDATE phase0_authz.tenants SET desired = desired + 1 WHERE organization = $1",
					[organization],
				);
				await client.query(
					"INSERT INTO phase0_authz.outbox (organization, revision) VALUES ($1,$2)",
					[organization, revision.desired + 1],
				);
				return value;
			},
			actor,
		);
	}
	async cleanup(
		graph: Graph,
		organizationPrefix: string,
		count = 1,
	): Promise<{ tuples: number; ms: number }> {
		const started = performance.now();
		const candidates = await this.pool.query<{
			id: string;
			model: string;
			tuples: Tuple[];
		}>(
			"SELECT id, model, tuples FROM phase0_authz.attempts WHERE state IN ('retired','abandoned') AND organization LIKE $1 ORDER BY cleaned_at NULLS FIRST, created_at LIMIT $2",
			[`${organizationPrefix}%`, count],
		);
		let tuples = 0;
		for (const attempt of candidates.rows) {
			for (let offset = 0; offset < attempt.tuples.length; offset += 100) {
				const batch = attempt.tuples.slice(offset, offset + 100);
				await graph.remove(batch, attempt.model);
				tuples += batch.length;
			}
			// Repeat sweeps: a late request can recreate unreachable tuples after cleanup.
			await this.pool.query(
				"UPDATE phase0_authz.attempts SET cleaned_at = now() WHERE id = $1",
				[attempt.id],
			);
		}
		return { tuples, ms: performance.now() - started };
	}
}

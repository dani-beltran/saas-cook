import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import { qualifyObject, qualifyTuples, type Tuple } from "./model.js";
import { type OpenFgaGraph, PostgresAuthority } from "./postgres.js";
import { type Revision, Unavailable } from "./protocol.js";

export const contextualLimits = { batch: 20, tuplesPerCheck: 100, depth: 3 };

function requireSourceReady(revision: Revision): void {
	if (!revision.ready) throw new Unavailable("recovery_pending");
	if (
		revision.evaluationMode !== "contextual" ||
		revision.applied !== revision.desired
	)
		throw new Unavailable("policy_mismatch");
}

/** The source commit is the publication boundary; no mutable remote graph exists. */
export class ContextualAuthority extends PostgresAuthority {
	readonly readinessMs: number[] = [];
	override async seed(
		organization: string,
		model: string,
		tuples: Tuple[],
		epoch: string,
	) {
		await super.seed(organization, model, tuples, epoch, "contextual");
	}
	override async change<T>(
		organization: string,
		fn: (client: PoolClient, revision: Revision) => Promise<T>,
		actor?: string,
		start = performance.now(),
	): Promise<T> {
		const value = await this.transaction(
			organization,
			true,
			async (client, revision) => {
				if (actor) requireSourceReady(revision);
				else if (revision.evaluationMode !== "contextual")
					throw new Unavailable("policy_mismatch");
				const result = await fn(client, revision);
				// Diagnostic commit journal only: no remote projection consumer. Update
				// the revision and journal together without an extra network round trip.
				await client.query(
					"WITH changed AS (UPDATE phase0_authz.tenants SET desired=desired+1,applied=desired+1 WHERE organization=$1 RETURNING organization,desired) INSERT INTO phase0_authz.outbox (organization,revision,applied_at) SELECT organization,desired,clock_timestamp() FROM changed",
					[organization],
				);
				return result;
			},
			actor,
		);
		this.readinessMs.push(performance.now() - start); // Includes commit acknowledgement.
		return value;
	}
}

function dependency(tuple: Tuple): string | undefined {
	if (tuple.user.startsWith("user:")) return;
	if (tuple.user.startsWith("team:") && tuple.user.endsWith("#member"))
		return tuple.user.slice(0, -7);
	if (tuple.relation === "organization" || tuple.relation === "parent")
		return tuple.user;
	throw new Unavailable("policy_mismatch");
}

/** Policy-specific closure for the pinned Phase 0 model, always inside its DB fence. */
export class ContextualPolicy {
	readonly buildMs: number[] = [];
	checks = 0;
	localDenials = 0;
	maxContextTuples = 0;
	constructor(
		readonly graph: OpenFgaGraph,
		readonly model: string,
	) {}

	/** A proof belongs to this invocation only; it is never exposed or cached. */
	async change<T>(
		authority: ContextualAuthority,
		organization: string,
		actor: string,
		object: string,
		mutation: (client: PoolClient, revision: Revision) => Promise<T>,
		permission = "can_manage",
	): Promise<T> {
		const start = performance.now();
		const proof = await authority.transaction(
			organization,
			false,
			async (client, revision) => {
				const prepared = await this.prepare(
					client,
					revision,
					actor,
					[object],
					permission,
				);
				if (!(await this.evaluate(prepared))[0])
					throw new Unavailable("denied");
				return prepared;
			},
			actor,
		);
		// A separate transaction takes the exclusive lock from its start. No lock
		// upgrade, and no earlier decision survives changed inputs or an expiry.
		return authority.change(
			organization,
			async (client, revision) => {
				const current = await this.prepare(
					client,
					revision,
					actor,
					[object],
					permission,
				);
				if (
					current.fingerprint !== proof.fingerprint ||
					current.checkedAt >= proof.expiresAt
				) {
					if (!(await this.evaluate(current))[0])
						throw new Unavailable("denied");
				}
				return mutation(client, revision);
			},
			actor,
			start,
		);
	}

	async check(
		client: PoolClient,
		revision: Revision,
		actor: string,
		objects: string[],
		permission = "can_read",
	): Promise<boolean[]> {
		return this.evaluate(
			await this.prepare(client, revision, actor, objects, permission),
		);
	}

	private async prepare(
		client: PoolClient,
		revision: Revision,
		actor: string,
		objects: string[],
		permission = "can_read",
	) {
		requireSourceReady(revision);
		if (
			revision.model !== this.model ||
			!["can_read", "can_manage"].includes(permission) ||
			objects.some((object) => !/^(project|workspace):[^\s#/:]+$/.test(object))
		)
			throw new Unavailable("policy_mismatch");
		if (!objects.length || objects.length > contextualLimits.batch)
			throw new Unavailable("context_limit");
		const start = performance.now();
		let checkedAt: Date | undefined;
		const byObject = new Map<string, Tuple[]>();
		// The pinned model uses this organization node on every resource. Fetch
		// it with the targets; other dependencies are still discovered normally.
		let frontier = [...new Set([...objects, "organization:root"])];
		const sourceLimit =
			contextualLimits.batch * contextualLimits.tuplesPerCheck;
		for (
			let depth = 0;
			frontier.length && depth < contextualLimits.depth;
			depth++
		) {
			const sourceSql = `SELECT s.tuple FROM phase0_authz.source_tuples s
				 WHERE s.organization=$1 AND s.tuple->>'object'=ANY($2::text[])
				 AND (s.tuple->>'user'=$3 OR s.tuple->>'relation' IN ('organization','parent')
				 OR (s.tuple->>'user' LIKE 'team:%#member' AND EXISTS (
				 SELECT 1 FROM phase0_authz.source_tuples m WHERE m.organization=$1
				 AND m.tuple->>'object'=split_part(s.tuple->>'user','#',1)
				 AND m.tuple->>'relation'='member' AND m.tuple->>'user'=$3))) LIMIT $4`;
			const result = await client.query<{
				tuple: Tuple | null;
				current_time?: Date;
			}>(
				depth === 0
					? `SELECT e.current_time,s.tuple FROM (SELECT clock_timestamp() AS current_time FROM phase0_authz.memberships WHERE organization=$1 AND actor=$3 AND active AND (expires_at IS NULL OR expires_at > clock_timestamp())) e LEFT JOIN LATERAL (${sourceSql}) s ON true`
					: sourceSql,
				[revision.organization, frontier, actor, sourceLimit + 1],
			);
			if (depth === 0) {
				checkedAt = result.rows[0]?.current_time;
				if (!checkedAt) throw new Unavailable("not_eligible");
			}
			const rows = {
				rows: result.rows.flatMap(({ tuple }) => (tuple ? [{ tuple }] : [])),
			};
			if (rows.rows.length > sourceLimit)
				throw new Unavailable("context_limit");
			for (const object of frontier) byObject.set(object, []);
			for (const { tuple } of rows.rows)
				byObject.get(tuple.object)?.push(tuple);
			frontier = [
				...new Set(
					rows.rows.flatMap(({ tuple }) => {
						const next = dependency(tuple);
						return next && !byObject.has(next) ? [next] : [];
					}),
				),
			];
			if (frontier.length > sourceLimit) throw new Unavailable("context_limit");
		}
		if (frontier.length) throw new Unavailable("context_limit");
		// A fresh namespace makes persisted tuples from any older request irrelevant.
		// Nothing from this context is written to OpenFGA or reused by another request.
		const namespace = { ...revision, generation: randomUUID() };
		let expiresAt = Number.POSITIVE_INFINITY;
		const fingerprints: string[][] = [];
		const checks = objects
			.map((object, index) => {
				const seen = new Set<string>();
				const tuples = new Map<string, Tuple>();
				const visit = (target: string) => {
					if (seen.has(target)) return;
					seen.add(target);
					for (const tuple of byObject.get(target) ?? []) {
						const key = JSON.stringify([
							tuple.user,
							tuple.relation,
							tuple.object,
						]);
						const previous = tuples.get(key);
						if (previous && JSON.stringify(previous) !== JSON.stringify(tuple))
							throw new Unavailable("policy_mismatch");
						tuples.set(key, tuple);
						if (tuples.size > contextualLimits.tuplesPerCheck)
							throw new Unavailable("context_limit");
						const next = dependency(tuple);
						if (next) visit(next);
					}
				};
				visit(object);
				fingerprints.push(
					[...tuples.values()]
						.map((tuple) => {
							if (tuple.condition) {
								const expiry = Date.parse(tuple.condition.context.expires_at);
								if (
									tuple.condition.name !== "before_expiry" ||
									!Number.isFinite(expiry)
								)
									throw new Unavailable("policy_mismatch");
								expiresAt = Math.min(expiresAt, expiry);
							}
							// Preserve every source field; a changed input must invalidate the proof.
							return JSON.stringify(tuple);
						})
						.sort(),
				);
				this.maxContextTuples = Math.max(this.maxContextTuples, tuples.size);
				// Necessary (not sufficient) grant paths in the pinned model. Absence
				// proves denial; presence still requires the real OpenFGA decision.
				const possible = [...tuples.values()].some(
					(tuple) =>
						tuple.relation === "admin" ||
						tuple.relation === "manager" ||
						(permission === "can_read" && tuple.relation === "viewer"),
				);
				if (!possible) {
					this.localDenials++;
					return null;
				}
				return {
					correlation_id: String(index),
					tuple_key: {
						user: actor,
						relation: permission,
						object: qualifyObject(object, namespace),
					},
					contextual_tuples: {
						tuple_keys: qualifyTuples([...tuples.values()], namespace),
					},
					context: { current_time: checkedAt?.toISOString() },
				};
			})
			.filter((check) => check !== null);
		this.buildMs.push(performance.now() - start);
		return {
			checks,
			outcomes: objects.map(() => false),
			checkedAt: (checkedAt as Date).getTime(),
			expiresAt,
			fingerprint: JSON.stringify([
				revision.organization,
				revision.epoch,
				revision.model,
				actor,
				objects,
				permission,
				fingerprints,
			]),
		};
	}

	private async evaluate(
		prepared: Awaited<ReturnType<ContextualPolicy["prepare"]>>,
	): Promise<boolean[]> {
		const { checks, outcomes } = prepared;
		this.checks += checks.length;
		if (!checks.length) return outcomes;
		if (checks.length === 1) {
			const { correlation_id, ...check } = checks[0];
			const response = await this.graph.request<{ allowed?: boolean }>(
				`/stores/${this.graph.store}/check`,
				{
					...check,
					authorization_model_id: this.model,
					consistency: "HIGHER_CONSISTENCY",
				},
			);
			if (typeof response.allowed !== "boolean")
				throw new Error("OpenFGA contextual check missing or failed");
			outcomes[Number(correlation_id)] = response.allowed;
			return outcomes;
		}
		const response = await this.graph.request<{
			result?: Record<string, { allowed?: boolean; error?: unknown }>;
		}>(`/stores/${this.graph.store}/batch-check`, {
			authorization_model_id: this.model,
			consistency: "HIGHER_CONSISTENCY",
			checks,
		});
		for (const { correlation_id } of checks) {
			const result = response.result?.[correlation_id];
			if (!result || result.error || typeof result.allowed !== "boolean")
				throw new Error("OpenFGA contextual check missing or failed");
			outcomes[Number(correlation_id)] = result.allowed;
		}
		return outcomes;
	}
}

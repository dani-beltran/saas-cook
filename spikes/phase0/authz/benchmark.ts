import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdir, rename, writeFile } from "node:fs/promises";
import { arch, cpus, platform, totalmem } from "node:os";
import { dirname } from "node:path";
import type { PoolClient } from "pg";
import { fixtureTuples, qualifyObject } from "./model.js";
import { limits, OpenFgaGraph, PostgresAuthority } from "./postgres.js";
import {
	checkAt,
	project,
	type Revision,
	requireReady,
	Unavailable,
} from "./protocol.js";

const smoke = process.argv.includes("--smoke");
const durationSeconds = Number(
	process.env.AUTHZ_DURATION_SECONDS ?? (smoke ? 10 : 1_800),
);
const warmupSeconds = Number(
	process.env.AUTHZ_WARMUP_SECONDS ?? (smoke ? 2 : 60),
);
const resourceCount = smoke ? 1_000 : 100_000;
const tenantCount = smoke ? 10 : 100;
const concurrency = 50;
if (
	!Number.isFinite(durationSeconds) ||
	!Number.isFinite(warmupSeconds) ||
	!(durationSeconds > 0) ||
	!(warmupSeconds >= 0)
)
	throw new Error("Invalid benchmark duration");
const database =
	process.env.AUTHZ_DATABASE_URL ??
	"postgresql://postgres:phase0@127.0.0.1:55432/phase0_authz";
const fgaUrl = process.env.OPENFGA_URL ?? "http://127.0.0.1:18080";
const output =
	process.env.AUTHZ_REPORT ?? "artifacts/phase0/authz-benchmark.json";
const storageBudgetBytes = Number(
	process.env.AUTHZ_STORAGE_BUDGET_BYTES ?? 2 * 1024 ** 3,
);
if (!Number.isSafeInteger(storageBudgetBytes) || storageBudgetBytes < 1)
	throw new Error("Storage budget must be a positive integer");
const retainedTupleBudget = 1_000_000;
const pause = (ms: number) =>
	new Promise<void>((resolve) => setTimeout(resolve, ms));
const prefix = `bench-${randomUUID()}`;
const tenants = Array.from(
	{ length: tenantCount },
	(_, index) => `${prefix}-${index}`,
);
const authority = new PostgresAuthority(database);
const projector = new PostgresAuthority(database, limits.projectorPool);
const collector = new PostgresAuthority(database, 2);
let graph!: OpenFgaGraph;
let model = "";
const epoch = randomUUID();
const projectionBuildMs: number[] = [];
const cleanupMs: number[] = [];
const createToReadableMs: number[] = [];
const readMs: number[] = [];
const writeMs: number[] = [];
const eventualMs: number[] = [];
const revocationMs: number[] = [];
const firstFailures: Record<string, number> = {};
const mix = { read: 0, update: 0, createDelete: 0, sharing: 0 };
let firstSuccesses = 0;
let eventualSuccesses = 0;
let requests = 0;
let hotRequests = 0;
let sparseLists = 0;
let createReadableTimeouts = 0;
let projectionFailures = 0;
let published = 0;
let abandoned = 0;
let cleanedTuples = 0;
let cleanupErrors = 0;
let stop = false;
let stopClients = false;
let measuring = false;
let warmAt = 0;
let startAt = 0;
let warmup = "";
let measuredTupleStart = 0;
let measuredWriteStart = 0;
const errors: string[] = [];
let fatalError: unknown;
let storage = {
	databaseBytes: 0,
	walBytes: 0,
	retainedTupleCount: 0,
	sampledAt: "",
};
let background: Promise<void>[] = [];
const projections = new Set<string>();
const failCode = (error: unknown) =>
	error instanceof Unavailable
		? error.code
		: ((error as { code?: string }).code ?? "dependency_error");
const stats = (values: number[]) => {
	values.sort((a, b) => a - b);
	const percentile = (p: number) =>
		values.length
			? (values[
					Math.min(values.length - 1, Math.ceil(values.length * p) - 1)
				] ?? null)
			: null;
	return {
		samples: values.length,
		p95: percentile(0.95),
		p99: percentile(0.99),
		max: values.at(-1) ?? null,
	};
};
function stopFor(error: unknown): void {
	fatalError ??= error;
	stopClients = true;
	stop = true;
}
process.once("SIGINT", () =>
	stopFor(new Error("Benchmark interrupted by SIGINT")),
);
process.once("SIGTERM", () =>
	stopFor(new Error("Benchmark interrupted by SIGTERM")),
);

async function checkpoint(event: string, error?: unknown): Promise<void> {
	const value = {
		schemaVersion: 1,
		event,
		capturedAt: new Date().toISOString(),
		gateStatus: "INCOMPLETE",
		candidateDecision: error ? "REJECT" : "PENDING",
		error: error ? String(error) : undefined,
		smoke,
		prefix,
		model,
		store: graph?.store,
		measuredSeconds: startAt ? (performance.now() - startAt) / 1_000 : 0,
		requiredDurationSeconds: 1_800,
		configuredDurationSeconds: durationSeconds,
		workload: {
			resourceCount,
			tenantCount,
			memberships: tenantCount * 10,
			concurrency,
			hotTenantFraction: 0.5,
			hotTrafficTarget: 0.8,
			mix,
			hotRequests,
			sparseLists,
		},
		limits: { ...limits, storageBudgetBytes, retainedTupleBudget },
		storage,
		requests,
		firstSuccesses,
		eventualSuccesses,
		firstFailures,
		published,
		abandoned,
		projectionFailures,
		cleanedTuples,
		cleanupErrors,
		createReadableTimeouts,
		latencyMs: {
			reads: stats([...readMs]),
			writes: stats([...writeMs]),
			fenceWaits: stats([
				...authority.fenceWaitMs,
				...authority.failedFenceWaitMs,
				...projector.fenceWaitMs,
				...projector.failedFenceWaitMs,
			]),
			build: stats([...projectionBuildMs]),
			cleanup: stats([...cleanupMs]),
			revocationCommit: stats([...revocationMs]),
			createToReadable: stats([...createToReadableMs]),
		},
		errors,
		note: "Live snapshots include in-flight requests. A checkpoint is never evidence of completed duration or gate approval.",
	};
	await mkdir(dirname(output), { recursive: true });
	const checkpointPath = error ? output : `${output}.checkpoint.json`;
	await writeFile(
		`${checkpointPath}.tmp`,
		`${JSON.stringify(value, null, 2)}\n`,
	);
	await rename(`${checkpointPath}.tmp`, checkpointPath);
}

async function checkStorage(): Promise<void> {
	// These diagnostic functions require the isolated fixture's privileged role.
	// Include FGA's database and WAL, not only the smaller application schema.
	const size = await collector.pool.query<{
		database_bytes: string;
		wal_bytes: string;
	}>(
		"SELECT (SELECT sum(pg_database_size(oid)) FROM pg_database WHERE datallowconn) AS database_bytes, (SELECT coalesce(sum(size),0) FROM pg_ls_waldir()) AS wal_bytes",
	);
	const retained = await collector.pool.query<{ count: string }>(
		"SELECT coalesce(sum(jsonb_array_length(tuples)),0) AS count FROM phase0_authz.attempts WHERE organization LIKE $1",
		[`${prefix}-%`],
	);
	const sizeRow = size.rows[0];
	const retainedRow = retained.rows[0];
	assert(sizeRow && retainedRow, "Missing storage diagnostics");
	storage = {
		databaseBytes: Number(sizeRow.database_bytes),
		walBytes: Number(sizeRow.wal_bytes),
		retainedTupleCount: Number(retainedRow.count),
		sampledAt: new Date().toISOString(),
	};
	if (storage.databaseBytes + storage.walBytes > storageBudgetBytes)
		throw new Error(
			`Storage budget exceeded: ${storage.databaseBytes + storage.walBytes} > ${storageBudgetBytes}`,
		);
	if (storage.retainedTupleCount > retainedTupleBudget)
		throw new Error(
			`Retained generation tuple budget exceeded: ${storage.retainedTupleCount} > ${retainedTupleBudget}`,
		);
}

async function diagnosticLoop(): Promise<void> {
	while (!stop) {
		await checkStorage();
		await checkpoint("running");
		for (let second = 0; second < 10 && !stop; second++) await pause(1_000);
	}
}
function random(seed: number) {
	let state = seed;
	return () => {
		state = Math.imul(state ^ (state >>> 15), 1 | state);
		state ^= state + Math.imul(state ^ (state >>> 7), 61 | state);
		return ((state ^ (state >>> 14)) >>> 0) / 4_294_967_296;
	};
}

async function authorized(
	organization: string,
	client: PoolClient,
	revision: Revision,
	permission = "can_manage",
) {
	requireReady(revision);
	if (
		!(await checkAt(
			graph,
			revision,
			`user:${organization}-u0`,
			"project:r000000",
			permission,
		))
	)
		throw new Unavailable("denied");
	return client;
}

async function operation(
	organization: string,
	kind: keyof typeof mix,
	seed: number,
	created: Map<string, string>,
): Promise<string | undefined> {
	const owner = `user:${organization}-u0`;
	if (kind === "read") {
		const sparse = seed % 4 === 0;
		const actor = sparse ? `user:${organization}-u1` : owner;
		return authority.transaction(
			organization,
			false,
			async (client, revision) => {
				requireReady(revision);
				if (!sparse) {
					if (!(await checkAt(graph, revision, actor, "project:r000000")))
						throw new Unavailable("denied");
					await client.query(
						"SELECT version FROM phase0_authz.resources WHERE organization=$1 AND object='project:r000000'",
						[organization],
					);
					return undefined;
				}
				if (measuring) sparseLists++;
				// Keyset pages scan a bounded 100 candidates, keeping the authorization fence.
				const rows = (
					await client.query<{ object: string }>(
						"SELECT object FROM phase0_authz.resources WHERE organization=$1 AND object > $2 ORDER BY object LIMIT 100",
						[organization, "project:r"],
					)
				).rows;
				const visible: string[] = [];
				let cursor: string | undefined;
				const began = performance.now();
				for (
					let offset = 0;
					offset < rows.length && performance.now() - began < 250;
					offset += 20
				) {
					const batch = rows.slice(offset, offset + 20);
					const checks = await Promise.all(
						batch.map((row) =>
							graph.check(
								actor,
								"can_read",
								qualifyObject(row.object, revision),
								model,
							),
						),
					);
					for (const [index, row] of batch.entries())
						if (checks[index]) visible.push(row.object);
					cursor = batch.at(-1)?.object;
					if (visible.length >= 20) break;
				}
				// Simulated DTO includes only permitted IDs and last-scanned cursor, no raw total.
				void { items: visible, cursor };
				return undefined;
			},
			actor,
		);
	}
	if (kind === "update") {
		return authority.transaction(
			organization,
			false,
			async (client, revision) => {
				await authorized(organization, client, revision);
				await client.query(
					"UPDATE phase0_authz.resources SET version=version+1 WHERE organization=$1 AND object='project:r000000'",
					[organization],
				);
				return undefined;
			},
			owner,
		);
	}
	return authority.change(
		organization,
		async (client, revision) => {
			await authorized(organization, client, revision);
			if (kind === "createDelete") {
				const previous = created.get(organization);
				if (previous) {
					await client.query(
						"DELETE FROM phase0_authz.resources WHERE organization=$1 AND object=$2",
						[organization, previous],
					);
					await client.query(
						"DELETE FROM phase0_authz.source_tuples WHERE organization=$1 AND tuple->>'object'=$2",
						[organization, previous],
					);
					created.delete(organization);
					return undefined;
				}
				const object = `project:c${randomUUID()}`;
				await client.query(
					"INSERT INTO phase0_authz.resources (organization, object) VALUES ($1,$2)",
					[organization, object],
				);
				for (const tuple of [
					{ user: "organization:root", relation: "organization", object },
					{ user: owner, relation: "manager", object },
				]) {
					await client.query(
						"INSERT INTO phase0_authz.source_tuples (organization, tuple) VALUES ($1,$2)",
						[organization, tuple],
					);
				}
				created.set(organization, object);
				return object;
			}
			// Cycle sharing, revocation and workspace moves; u1 remains exactly the sparse fixture principal.
			if (seed % 3 === 0) {
				await client.query(
					"DELETE FROM phase0_authz.source_tuples WHERE organization=$1 AND tuple->>'object'='project:r000001' AND tuple->>'relation'='parent'",
					[organization],
				);
				await client.query(
					"INSERT INTO phase0_authz.source_tuples (organization,tuple) VALUES ($1,$2)",
					[
						organization,
						{
							user: seed % 2 ? "workspace:a" : "workspace:b",
							relation: "parent",
							object: "project:r000001",
						},
					],
				);
			} else {
				await client.query(
					"DELETE FROM phase0_authz.source_tuples WHERE organization=$1 AND tuple->>'object'='project:r000001' AND tuple->>'user'=$2",
					[organization, `user:${organization}-u4`],
				);
				if (seed % 3 === 1)
					await client.query(
						"INSERT INTO phase0_authz.source_tuples (organization,tuple) VALUES ($1,$2)",
						[
							organization,
							{
								user: `user:${organization}-u4`,
								relation: "viewer",
								object: "project:r000001",
							},
						],
					);
			}
			return undefined;
		},
		owner,
	);
}

async function projectionLoop() {
	while (!stop) {
		const candidates = await projector.pool.query<{ organization: string }>(
			"SELECT organization FROM phase0_authz.tenants WHERE desired != applied AND organization LIKE $1 ORDER BY organization",
			[`${prefix}-%`],
		);
		for (const { organization } of candidates.rows) {
			if (stop || projections.size >= 3) break;
			if (projections.has(organization)) continue;
			projections.add(organization);
			void project(projector, graph, organization)
				.then((result) => {
					if (measuring) {
						projectionBuildMs.push(result.buildMs);
						if (result.published) published++;
						else abandoned++;
					}
				})
				.catch((error: unknown) => {
					if (measuring) projectionFailures++;
					if (errors.length < 10) errors.push(String(error));
				})
				.finally(() => projections.delete(organization));
		}
		await pause(10);
	}
	while (projections.size) await pause(10);
}

async function cleanupLoop() {
	while (!stop) {
		try {
			const result = await collector.cleanup(graph, `${prefix}-`);
			if (measuring && result.tuples) {
				cleanupMs.push(result.ms);
				cleanedTuples += result.tuples;
			}
		} catch (error) {
			if (measuring) cleanupErrors++;
			if (errors.length < 10) errors.push(String(error));
		}
		await pause(250);
	}
}

async function clientLoop(id: number) {
	const rng = random(1729 + id);
	const created = new Map<string, string>();
	while (!stopClients) {
		const organization =
			rng() < 0.8
				? tenants[0]
				: tenants[1 + Math.floor(rng() * (tenants.length - 1))];
		assert(organization, "Missing benchmark tenant");
		const selection = rng();
		const kind =
			selection < 0.6
				? "read"
				: selection < 0.8
					? "update"
					: selection < 0.9
						? "createDelete"
						: "sharing";
		const seed = Math.floor(rng() * 1_000_000);
		const sample = measuring;
		const began = performance.now();
		if (sample) {
			requests++;
			mix[kind]++;
			if (organization === tenants[0]) hotRequests++;
		}
		let succeeded = false;
		let createdObject: string | undefined;
		for (let attempt = 0; attempt < 2; attempt++) {
			try {
				createdObject = await operation(organization, kind, seed, created);
				succeeded = true;
				if (sample && attempt === 0) {
					firstSuccesses++;
					(kind === "read" ? readMs : writeMs).push(performance.now() - began);
				}
				break;
			} catch (error) {
				const code = failCode(error);
				if (sample && attempt === 0)
					firstFailures[code] = (firstFailures[code] ?? 0) + 1;
				if (
					!["projection_pending", "lock_timeout", "queue_full"].includes(code)
				)
					break;
				if (attempt === 0) await pause(25);
			}
		}
		if (sample && succeeded) {
			eventualSuccesses++;
			eventualMs.push(performance.now() - began);
		}
		if (sample && succeeded && kind === "sharing" && seed % 3 === 2) {
			// Revocation becomes effective at commit. Fault tests independently check denial;
			// another concurrent command can legitimately regrant after this commit.
			revocationMs.push(performance.now() - began);
		}
		if (createdObject) {
			const committedObject = createdObject;
			let readable = false;
			while (performance.now() - began < 2_000) {
				try {
					readable = await authority.transaction(
						organization,
						false,
						(_client, revision) =>
							checkAt(
								graph,
								revision,
								`user:${organization}-u0`,
								committedObject,
							),
						`user:${organization}-u0`,
					);
					if (readable) break;
				} catch {
					/* A bounded pending-readiness retry; command success stays recorded. */
				}
				await pause(25);
			}
			if (sample) {
				if (readable) createToReadableMs.push(performance.now() - began);
				else createReadableTimeouts++;
			}
		}
	}
}

try {
	await authority.install();
	({ graph, model } = await OpenFgaGraph.create(fgaUrl));
	await checkStorage();
	console.info(
		JSON.stringify({
			event: "seeding",
			tenants: tenantCount,
			resources: resourceCount,
			clients: concurrency,
			durationSeconds,
			smoke,
		}),
	);
	let remaining = resourceCount;
	for (const [index, organization] of tenants.entries()) {
		if (fatalError) throw fatalError;
		const count =
			index === 0
				? resourceCount / 2
				: Math.floor(remaining / (tenantCount - index));
		remaining -= count;
		await authority.seed(
			organization,
			model,
			fixtureTuples(organization, count),
			epoch,
		);
		await project(projector, graph, organization);
		await checkStorage();
		if (index % 10 === 0) await checkpoint("seeding");
	}
	const baseTupleCount = graph.tuplesWritten;
	const baseWriteCalls = graph.writeCalls;
	background = [projectionLoop(), cleanupLoop(), diagnosticLoop()].map((work) =>
		work.catch(stopFor),
	);
	warmAt = performance.now();
	warmup = new Date().toISOString();
	const clients = Array.from({ length: concurrency }, (_, index) =>
		clientLoop(index).catch(stopFor),
	);
	await pause(warmupSeconds * 1_000);
	if (fatalError) throw fatalError;
	authority.fenceWaitMs.length = 0;
	authority.failedFenceWaitMs.length = 0;
	authority.poolWaitMs.length = 0;
	projector.fenceWaitMs.length = 0;
	projector.failedFenceWaitMs.length = 0;
	projector.poolWaitMs.length = 0;
	startAt = performance.now();
	measuredTupleStart = graph.tuplesWritten;
	measuredWriteStart = graph.writeCalls;
	const measuredAt = new Date().toISOString();
	measuring = true;
	console.info(
		JSON.stringify({
			event: "measuring",
			measuredAt,
			durationSeconds,
			model,
			store: graph.store,
		}),
	);
	for (
		let remainingSeconds = durationSeconds;
		remainingSeconds > 0 && !stop;
		remainingSeconds -= 30
	) {
		for (
			let second = 0;
			second < Math.min(30, remainingSeconds) && !stop;
			second++
		)
			await pause(1_000);
		console.info(
			JSON.stringify({
				event: "progress",
				seconds: (performance.now() - startAt) / 1_000,
				requests,
				firstSuccesses,
				firstFailures,
				published,
				abandoned,
			}),
		);
	}
	const elapsedSeconds = (performance.now() - startAt) / 1_000;
	stopClients = true;
	await Promise.all(clients);
	if (fatalError) throw fatalError;
	const drainStarted = performance.now();
	while (performance.now() - drainStarted < 30_000) {
		const pending = await authority.pool.query(
			"SELECT 1 FROM phase0_authz.tenants WHERE desired != applied AND organization LIKE $1 LIMIT 1",
			[`${prefix}-%`],
		);
		if (!pending.rowCount) break;
		await pause(100);
	}
	stop = true;
	await Promise.all(background);
	const projectionRows = await authority.pool.query<{
		ms: number;
		pending: boolean;
	}>(
		"SELECT extract(epoch FROM (coalesce(applied_at, now()) - created_at)) * 1000 AS ms, applied_at IS NULL AS pending FROM phase0_authz.outbox WHERE organization LIKE $1 AND created_at >= $2",
		[`${prefix}-%`, measuredAt],
	);
	const attemptRows = await authority.pool.query<{
		state: string;
		count: string;
	}>(
		"SELECT state,count(*) FROM phase0_authz.attempts WHERE organization LIKE $1 AND created_at >= $2 GROUP BY state",
		[`${prefix}-%`, measuredAt],
	);
	const attemptStates = Object.fromEntries(
		attemptRows.rows.map((row) => [row.state, Number(row.count)]),
	);
	const attemptsStarted = Object.values(attemptStates).reduce(
		(sum, count) => sum + count,
		0,
	);
	const projectionLatency = stats(
		projectionRows.rows
			.filter((row) => !row.pending)
			.map((row) => Number(row.ms)),
	);
	const result = {
		schemaVersion: 1,
		protocol: "immutable full graph per attempt",
		backend: "real PostgreSQL and OpenFGA",
		smoke,
		startedAt: measuredAt,
		warmupAt: warmup,
		warmupActualSeconds: (startAt - warmAt) / 1_000,
		elapsedSeconds,
		qualifiedWorkload:
			!smoke &&
			durationSeconds >= 1_800 &&
			elapsedSeconds >= 1_800 &&
			warmupSeconds >= 60 &&
			Boolean(process.env.OPENFGA_VERSION && process.env.AUTHZ_DOCKER_LIMITS),
		environment: {
			node: process.version,
			platform: platform(),
			arch: arch(),
			cpu: cpus()[0]?.model,
			logicalCpus: cpus().length,
			hostMemoryBytes: totalmem(),
			serviceVersions: {
				postgres: (
					await authority.pool.query<{ server_version: string }>(
						"SHOW server_version",
					)
				).rows[0]?.server_version,
				openFga: process.env.OPENFGA_VERSION ?? "not-recorded",
			},
			dockerLimits: process.env.AUTHZ_DOCKER_LIMITS ?? "not-recorded",
		},
		workload: {
			tenants: tenantCount,
			memberships: tenantCount * 10,
			resources: resourceCount,
			hotTenantResources: resourceCount / 2,
			clients: concurrency,
			mix,
			sparseLists,
			hotTrafficFraction: hotRequests / requests,
			seed: 1729,
			listScanLimit: 100,
			listBatch: 20,
			listTimeBudgetMs: 250,
		},
		limits: { ...limits, storageBudgetBytes, retainedTupleBudget },
		storage,
		retries: {
			commandAttempts: 2,
			delayMs: 25,
			remoteWriteRetries: 0,
			createReadBudgetMs: 2_000,
			createReadDelayMs: 25,
		},
		graph: {
			baseTuples: baseTupleCount,
			baseWriteCalls,
			tuplesWrittenIncludingWarmup: graph.tuplesWritten - baseTupleCount,
			writeCallsIncludingWarmup: graph.writeCalls - baseWriteCalls,
			tuplesWrittenDuringMeasurementAndDrain:
				graph.tuplesWritten - measuredTupleStart,
			writeCallsDuringMeasurementAndDrain:
				graph.writeCalls - measuredWriteStart,
			cleanedTuples,
			cleanupErrors,
			writeAmplificationPerCommittedChange:
				(graph.tuplesWritten - measuredTupleStart) /
				Math.max(1, projectionRows.rowCount ?? 0),
			attemptStates,
			attemptsStarted,
			abandonedBuildRate:
				(attemptStates.abandoned ?? 0) / Math.max(1, attemptsStarted),
			published,
			abandoned,
			projectionFailures,
			pendingRevisions: projectionRows.rows.filter((row) => row.pending).length,
		},
		requests,
		requestRate: requests / elapsedSeconds,
		firstSuccesses,
		eventualSuccesses,
		firstFailures,
		deliberateDenials: firstFailures.denied ?? 0,
		firstSuccessFraction:
			firstSuccesses / Math.max(1, requests - (firstFailures.denied ?? 0)),
		eventualSuccessFraction:
			eventualSuccesses / Math.max(1, requests - (firstFailures.denied ?? 0)),
		latencyMs: {
			reads: stats(readMs),
			writes: stats(writeMs),
			eventual: stats(eventualMs),
			fenceWaits: stats([
				...authority.fenceWaitMs,
				...projector.fenceWaitMs,
				...authority.failedFenceWaitMs,
				...projector.failedFenceWaitMs,
			]),
			failedFenceWaits: stats([
				...authority.failedFenceWaitMs,
				...projector.failedFenceWaitMs,
			]),
			poolWaits: stats([...authority.poolWaitMs, ...projector.poolWaitMs]),
			projection: projectionLatency,
			revocationCommit: stats(revocationMs),
			build: stats(projectionBuildMs),
			cleanup: stats(cleanupMs),
			createToReadable: stats(createToReadableMs),
		},
		createReadableTimeouts,
		errors,
	};
	const failures: string[] = [];
	if (result.firstSuccessFraction < 0.999)
		failures.push("eligible first-attempt success below 99.9%");
	for (const [name, metric, target] of [
		["reads", result.latencyMs.reads, 500],
		["writes", result.latencyMs.writes, 800],
		["projection", result.latencyMs.projection, 2_000],
		["createToReadable", result.latencyMs.createToReadable, 2_000],
		["fenceWaits", result.latencyMs.fenceWaits, 100],
	] as const) {
		if (metric.p95 === null || metric.p95 >= target)
			failures.push(`${name} p95 missing or >= ${target}ms`);
	}
	if (createReadableTimeouts)
		failures.push("create-to-readable exceeded bounded 2s window");
	if (result.graph.pendingRevisions)
		failures.push("pending revisions at workload end");
	if (result.graph.cleanupErrors || projectionFailures)
		failures.push("healthy dependency errors");
	const report = {
		...result,
		gateStatus: !result.qualifiedWorkload
			? "INCOMPLETE"
			: failures.length
				? "FAIL"
				: "PASS",
		candidateDecision: failures.length
			? "REJECT"
			: !result.qualifiedWorkload
				? "PENDING"
				: "HEALTHY_GATE_PASSED",
		failures,
		note: "A passing healthy run does not replace the separate fault suite, real feature rerun, or monthly availability measurement. Outbox projection latency also bounds graph-ready revocation; authoritative revocation is effective at DB commit.",
	};
	await mkdir(dirname(output), { recursive: true });
	await writeFile(output, `${JSON.stringify(report, null, 2)}\n`);
	console.info(
		JSON.stringify({
			event: "complete",
			output,
			gateStatus: report.gateStatus,
			failures,
		}),
	);
	if (failures.length || !result.qualifiedWorkload) process.exitCode = 2;
} catch (error) {
	stopFor(error);
	await checkpoint("terminated", error);
	console.error(
		JSON.stringify({
			event: "terminated",
			output,
			error: String(error),
			gateStatus: "INCOMPLETE",
		}),
	);
	process.exitCode = 2;
} finally {
	stop = true;
	stopClients = true;
	await Promise.all(background);
	await Promise.all([
		authority.pool.end(),
		projector.pool.end(),
		collector.pool.end(),
	]);
}

import assert from "node:assert/strict";
import { AsyncLocalStorage } from "node:async_hooks";
import { execFile } from "node:child_process";
import { createHmac, randomUUID } from "node:crypto";
import { channel } from "node:diagnostics_channel";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import os from "node:os";
import { performance } from "node:perf_hooks";
import { promisify } from "node:util";
import { createApiClient } from "../../packages/api/src/client";
import { handleApi } from "../../packages/api/src/handlers";
import {
	applicationRuntime,
	shutdownApplicationRuntime,
} from "../../packages/api/src/runtime";
import type { ProjectDto } from "../../packages/api-contracts/src/index";
import type { TenantActor } from "../../packages/db/src/tenancy";
import { sourceFingerprint } from "../phase1/source-fingerprint";
import { resourceFixture } from "./fixture";

const executeFile = promisify(execFile);
const runId = new Date().toISOString().replace(/[:.]/g, "-");
let interrupted: string | undefined;
let stage = "initialization";
let measureStartedAt: number | undefined;
const operationCounts: Record<string, number> = {};
const failuresByOperation: Record<string, number> = {};
let warmupFailures = 0;
let shareConfirmations = 0;
const revocationFence = new AsyncLocalStorage<boolean>();
const revocationFenceWait: number[] = [];
for (const signal of ["SIGINT", "SIGTERM"] as const)
	process.once(signal, () => {
		interrupted = signal;
		console.log(
			JSON.stringify({ event: "benchmark.interrupted", signal, stage }),
		);
	});
async function command(file: string, args: string[]) {
	try {
		return (
			await executeFile(file, args, {
				maxBuffer: 8 * 1024 * 1024,
				timeout: 15000,
			})
		).stdout.trim();
	} catch {
		return undefined;
	}
}
async function fingerprint() {
	return {
		sha256: await sourceFingerprint(),
		algorithm: "shared scripts/phase1/source-fingerprint.ts",
	};
}
async function serviceContainers() {
	const ids = await command("docker", [
		"compose",
		"-f",
		"infra/compose.yaml",
		"ps",
		"-q",
		"postgres",
		"control-postgres",
		"openfga",
	]);
	if (!ids) return { available: false };
	const containers = [];
	for (const id of ids.split(/\s+/)) {
		const raw = await command("docker", [
			"inspect",
			"--format",
			"{{json .}}",
			id,
		]);
		if (!raw) continue;
		const row = JSON.parse(raw);
		containers.push({
			id: row.Id,
			name: row.Name,
			image: row.Config.Image,
			imageId: row.Image,
			limits: {
				memoryBytes: row.HostConfig.Memory,
				nanoCpus: row.HostConfig.NanoCpus,
				cpuQuota: row.HostConfig.CpuQuota,
				cpuPeriod: row.HostConfig.CpuPeriod,
				cpusetCpus: row.HostConfig.CpusetCpus,
				tmpfs: row.HostConfig.Tmpfs,
			},
			command: row.Config.Cmd?.filter((value: string) =>
				/^[\w./-]+$/.test(value),
			),
			...(row.Name.includes("openfga")
				? {
						version: await command("docker", [
							"exec",
							id,
							"/openfga",
							"version",
						]),
					}
				: {}),
		});
	}
	return { available: containers.length === 3, containers };
}
async function atomicReport(path: string, evidence: unknown) {
	await mkdir("artifacts/phase3", { recursive: true });
	await writeFile(`${path}.tmp`, `${JSON.stringify(evidence, null, 2)}\n`);
	await rename(`${path}.tmp`, path);
}
const sourceBefore = await fingerprint();
const buildMetadata = {
	head: await command("git", ["rev-parse", "HEAD"]),
	base:
		(await command("git", ["merge-base", "HEAD", "origin/main"])) ??
		(await command("git", ["merge-base", "HEAD", "main"])),
	dirty: Boolean(await command("git", ["status", "--porcelain"])),
	sourceBefore,
	packageManager: JSON.parse(await readFile("package.json", "utf8"))
		.packageManager,
	services: await serviceContainers(),
};
const smoke = process.argv.includes("--smoke");
const profile = process.argv.includes("--profile");
const durationMs = smoke ? 15_000 : 30 * 60_000;
const warmupMs = smoke ? 2_000 : 60_000;
const cursorIdleLimitMs = 5 * 60_000;
const eventLoopProbeMs = 1000;
const eventLoopStallLimitMs = 5000;
let maxEventLoopLagMs = 0;
let idleCursorResets = 0;
const clients = 50,
	tenants = 100,
	resourceCount = 100_000;
let measuring = false;
const fenceWait: number[] = [],
	read: number[] = [],
	write: number[] = [],
	readable: number[] = [],
	revocation: number[] = [],
	readiness: number[] = [];
let attempts = 0,
	successes = 0,
	hotRequests = 0,
	sparseLists = 0,
	sparseRows = 0,
	revocationDenials = 0;
const failures: Record<string, number> = {};
const failureCodes: Record<string, number> = {};
const failureStatuses: Record<string, number> = {};
const contextualTupleCounts: number[] = [];
let measuredFgaChecks = 0;
let measuredFgaWrites = 0;
const fenceChannel = channel("saas-cook.authorization.fence-wait");
const fenceListener = (message: unknown) => {
	const milliseconds = (message as { milliseconds?: unknown }).milliseconds;
	if (!measuring || typeof milliseconds !== "number") return;
	fenceWait.push(milliseconds);
	if (revocationFence.getStore()) revocationFenceWait.push(milliseconds);
};
fenceChannel.subscribe(fenceListener);
const f = await resourceFixture({
	defaultProjectCapacity: null,
	// Match packages/api/src/runtime.ts; all 50 clients still submit concurrently.
	poolSize: 8,
});
// Counts only: never retain or serialize request bodies, tuple identifiers or credentials.
const originalFetch = globalThis.fetch;
const fgaPrefix = `${f.installation.env.OPENFGA_API_URL.replace(/\/$/, "")}/stores/`;
globalThis.fetch = ((
	input: Parameters<typeof fetch>[0],
	init?: Parameters<typeof fetch>[1],
) => {
	const url = input instanceof Request ? input.url : String(input);
	if (measuring && url.startsWith(fgaPrefix)) {
		if (url.endsWith("/write")) measuredFgaWrites++;
		if (url.endsWith("/check")) {
			measuredFgaChecks++;
			if (typeof init?.body === "string") {
				try {
					const tuples = JSON.parse(init.body).contextual_tuples?.tuple_keys;
					if (Array.isArray(tuples)) contextualTupleCounts.push(tuples.length);
				} catch {
					/* Invalid bodies are handled by the real adapter. */
				}
			}
		}
	}
	return originalFetch(input, init);
}) as typeof fetch;
const benchmarkOrigin = "http://localhost:3103";
const environment = {
	...f.installation.env,
	APP_ORIGIN: benchmarkOrigin,
	DEFAULT_PROJECT_CAPACITY: "unlimited",
};
const originalEnvironment = Object.fromEntries(
	Object.keys(environment).map((key) => [key, process.env[key]]),
);
Object.assign(process.env, environment);
const cookies = new Map<string, string>();
const rpcClients = new Map<string, ReturnType<typeof createApiClient>>();
function rpcClient(actor: TenantActor) {
	let client = rpcClients.get(actor.userId);
	if (!client) {
		client = createApiClient(
			`${benchmarkOrigin}/api/rpc`,
			async (request, init) => {
				const headers = new Headers(
					request instanceof Request ? request.headers : init?.headers,
				);
				headers.set("cookie", cookies.get(actor.userId) ?? "");
				headers.set("origin", benchmarkOrigin);
				return handleApi(new Request(request, { ...init, headers }), "rpc");
			},
		);
		rpcClients.set(actor.userId, client);
	}
	return client;
}
class BenchmarkApiError extends Error {
	constructor(
		public readonly code: string,
		public readonly status: number,
	) {
		super(code);
	}
}
async function restCall<T>(
	actor: TenantActor,
	org: string,
	resource: "projects" | "resource-grants",
	action: string,
	input: Record<string, unknown>,
): Promise<T> {
	const reference = resource === "resource-grants" ? input.grantId : input.id;
	const url = new URL(
		`/api/v1/organizations/${org}/${resource}${reference ? `/${reference}` : ""}`,
		benchmarkOrigin,
	);
	const method =
		action === "get" || action === "list"
			? "GET"
			: action === "update"
				? "PATCH"
				: action === "delete" || action === "revoke"
					? "DELETE"
					: "POST";
	if (method === "GET")
		for (const [key, value] of Object.entries(input))
			if (key !== "id" && value !== undefined)
				url.searchParams.set(key, String(value));
	const response = await handleApi(
		new Request(url, {
			method,
			headers: {
				cookie: cookies.get(actor.userId) ?? "",
				origin: benchmarkOrigin,
				"content-type": "application/json",
			},
			...(method === "GET" ? {} : { body: JSON.stringify(input) }),
		}),
		"rest",
	);
	const body = await response.json();
	if (!response.ok) throw new BenchmarkApiError(body.code, response.status);
	return body as T;
}
function resourceApi(transport: "rpc" | "rest") {
	return {
		getProject: (actor: TenantActor, org: string, input: { id: string }) =>
			transport === "rpc"
				? rpcClient(actor).projects.get({ organizationId: org, ...input })
				: restCall<ProjectDto>(actor, org, "projects", "get", input),
		listProjects: (
			actor: TenantActor,
			org: string,
			input: { limit: number; cursor?: string },
		) =>
			transport === "rpc"
				? rpcClient(actor).projects.list({ organizationId: org, ...input })
				: restCall<{ items: ProjectDto[]; nextCursor: string | null }>(
						actor,
						org,
						"projects",
						"list",
						input,
					),
		createProject: (
			actor: TenantActor,
			org: string,
			input: { name: string; slug: string; operationKey: string },
		) =>
			transport === "rpc"
				? rpcClient(actor).projects.create({ organizationId: org, ...input })
				: restCall<ProjectDto>(actor, org, "projects", "create", input),
		updateProject: (
			actor: TenantActor,
			org: string,
			input: { id: string; version: number; name: string },
		) =>
			transport === "rpc"
				? rpcClient(actor).projects.update({ organizationId: org, ...input })
				: restCall<ProjectDto>(actor, org, "projects", "update", input),
		deleteProject: (
			actor: TenantActor,
			org: string,
			input: { id: string; version: number; operationKey: string },
		) =>
			transport === "rpc"
				? rpcClient(actor).projects.delete({ organizationId: org, ...input })
				: restCall<ProjectDto>(actor, org, "projects", "delete", input),
		grant: (
			actor: TenantActor,
			org: string,
			input: {
				resourceId: string;
				subject: { kind: "membership"; id: string };
				relation: "viewer";
				operationKey: string;
			},
		) =>
			transport === "rpc"
				? rpcClient(actor).grants.create({ organizationId: org, ...input })
				: restCall<{ id: string }>(
						actor,
						org,
						"resource-grants",
						"create",
						input,
					),
		revokeGrant: (
			actor: TenantActor,
			org: string,
			input: { grantId: string },
		) =>
			transport === "rpc"
				? rpcClient(actor).grants.revoke({ organizationId: org, ...input })
				: restCall<{ ok: true }>(
						actor,
						org,
						"resource-grants",
						"revoke",
						input,
					),
	};
}
async function storageSnapshot() {
	const application = (
		await f.app.query(
			"SELECT pg_database_size(current_database())::text AS database_bytes,pg_current_wal_lsn()::text AS wal_lsn,pg_wal_lsn_diff(pg_current_wal_lsn(),'0/0')::text AS wal_position_bytes,version() AS version,current_setting('shared_buffers') AS shared_buffers,current_setting('max_connections') AS max_connections,current_setting('work_mem') AS work_mem,current_setting('fsync') AS fsync,current_setting('synchronous_commit') AS synchronous_commit",
		)
	).rows[0];
	const relations = (
		await f.app.query(
			"SELECT relname,pg_total_relation_size(c.oid)::text AS bytes FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname IN ('tenancy','identity','foundation') AND relkind='r' ORDER BY relname",
		)
	).rows;
	const control = (
		await f.reader.query(
			"SELECT pg_database_size(current_database())::text AS database_bytes,pg_current_wal_lsn()::text AS wal_lsn,pg_wal_lsn_diff(pg_current_wal_lsn(),'0/0')::text AS wal_position_bytes,version() AS version",
		)
	).rows[0];
	return {
		sampledAt: new Date().toISOString(),
		application,
		control,
		relations,
		walScope:
			"WAL positions are cluster-wide and include any concurrent database activity; database/relation sizes are fixture-specific.",
	};
}
async function graphSnapshot() {
	const state = await f.authorization.publication(source);
	const response = await fetch(
		`${f.installation.env.OPENFGA_API_URL}/stores/${state.storeId}/read`,
		{
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ page_size: 1 }),
			signal: AbortSignal.timeout(3000),
		},
	);
	if (!response.ok) throw new Error("Graph tuple inspection failed");
	const body = (await response.json()) as {
		tuples?: unknown[];
		continuation_token?: string;
	};
	if (!Array.isArray(body.tuples))
		throw new Error("Invalid graph tuple inspection");
	return {
		sampledAt: new Date().toISOString(),
		storeId: state.storeId,
		modelId: state.modelId,
		modelHash: state.modelHash,
		observedTuples: body.tuples.length,
		exact: !body.continuation_token,
		verifiedEmpty: body.tuples.length === 0 && !body.continuation_token,
	};
}
let storageBefore: Awaited<ReturnType<typeof storageSnapshot>> | undefined;
let graphBefore: Awaited<ReturnType<typeof graphSnapshot>> | undefined;
function partialEvidence(status = "running") {
	const seconds =
		measureStartedAt === undefined
			? 0
			: Math.max(0, (performance.now() - measureStartedAt) / 1000);
	return {
		status,
		stage,
		interrupted,
		runId,
		checkpointAt: new Date().toISOString(),
		scope:
			"actual in-process RPC/REST handler, real signed Better Auth sessions; excludes TCP and Next wrapper overhead",
		attempts,
		successes,
		failures,
		failuresByOperation,
		failureCodes,
		failureStatuses,
		contextualTupleCounts: stats(contextualTupleCounts),
		measuredFgaChecks,
		measuredFgaWrites,
		mix: operationCounts,
		authorizationChanges: {
			shareConfirmations,
			revocationDenials,
			warmupFailures,
			valid:
				warmupFailures === 0 &&
				shareConfirmations > 0 &&
				revocationDenials > 0 &&
				shareConfirmations ===
					(operationCounts.share ?? 0) - (failuresByOperation.share ?? 0) &&
				revocationDenials ===
					(operationCounts.revoke ?? 0) - (failuresByOperation.revoke ?? 0),
		},
		firstAttemptSuccessRate: attempts ? successes / attempts : null,
		durationSeconds: seconds,
		requestedDurationMs: durationMs,
		clients,
		resourceCount,
		cursorPolicy: {
			idleLimitMs: cursorIdleLimitMs,
			measuredResets: idleCursorResets,
		},
		eventLoop: {
			probeIntervalMs: eventLoopProbeMs,
			stallLimitMs: eventLoopStallLimitMs,
			maxLagMs: maxEventLoopLagMs,
			scope:
				"warmup and measured traffic; a stall invalidates the run without retries",
		},
		source: buildMetadata,
		storageBefore,
		graphBefore,
		latencyMs: {
			read: stats(read),
			write: stats(write),
			fenceWait: stats(fenceWait),
			createToReadable: stats(readable),
			revocation: stats(revocation),
			revocationFenceWait: stats(revocationFenceWait),
			sourceCommit: stats(readiness),
		},
	};
}
const reportPath = `artifacts/phase3/authorization-${smoke ? "smoke" : "benchmark"}-${runId}.json`;
const sqlTimings = new Map<string, number[]>();
if (profile) {
	f.web.on("connect", (client) => {
		const original = client.query.bind(client);
		client.query = ((...args: unknown[]) => {
			const begin = performance.now();
			const value = Reflect.apply(original, client, args);
			const statement =
				typeof args[0] === "string"
					? args[0].replace(/\s+/g, " ").slice(0, 110)
					: "query";
			return value instanceof Promise
				? value.finally(() => {
						if (!measuring) return;
						const values = sqlTimings.get(statement) ?? [];
						values.push(performance.now() - begin);
						sqlTimings.set(statement, values);
					})
				: value;
		}) as typeof client.query;
	});
}
function stats(values: number[]) {
	const ordered = [...values].sort((a, b) => a - b);
	const at = (fraction: number) =>
		ordered[
			Math.min(ordered.length - 1, Math.ceil(ordered.length * fraction) - 1)
		] ?? 0;
	return {
		count: ordered.length,
		p95: at(0.95),
		p99: at(0.99),
		max: ordered.at(-1) ?? 0,
	};
}
const organizations = Array.from({ length: tenants }, () => randomUUID());
const users = organizations.map(() =>
	Array.from({ length: 10 }, () => randomUUID()),
);
const memberships = organizations.map(() =>
	Array.from({ length: 10 }, () => randomUUID()),
);
const projectIds: string[][] = [];
const actors: TenantActor[][] = users.map((group) =>
	group.map((userId) => ({
		userId,
		authenticatedAt: new Date(),
		mfa: true,
		method: "passkey",
	})),
);
const source = await f.app.connect();
const started = new Date();
try {
	stage = "seeding";
	await atomicReport(reportPath, partialEvidence());
	console.log("Seeding 100 tenants, 1,000 memberships, 100,000 Projects");
	await source.query("BEGIN");
	for (let index = 0; index < tenants; index++) {
		if (interrupted) throw new Error("Benchmark interrupted while seeding");
		const org = organizations[index];
		await source.query(
			"INSERT INTO identity.\"user\"(id,name,email,email_verified) SELECT u,u,u||'@example.test',true FROM unnest($1::text[]) u",
			[users[index]],
		);
		await source.query(
			"INSERT INTO tenancy.organizations(id,slug,name) VALUES($1,$2,'Benchmark tenant')",
			[org, `bench-${index}`],
		);
		await source.query(
			"INSERT INTO tenancy.memberships(id,organization_id,user_id,role,status,billable) SELECT m,$1,u,CASE WHEN n=1 THEN 'owner' ELSE 'member' END,'active',true FROM unnest($2::uuid[],$3::text[]) WITH ORDINALITY AS t(m,u,n)",
			[org, memberships[index], users[index]],
		);
		await source.query(
			"INSERT INTO tenancy.seat_capacities(organization_id,capacity,occupied) VALUES($1,100,10)",
			[org],
		);
		await f.authorization.initialize(source, org);
		const count =
			index === 0
				? 50_000
				: Math.floor(50_000 / 99) + (index <= 50_000 % 99 ? 1 : 0);
		const ids = Array.from({ length: count }, () => randomUUID());
		projectIds.push(ids);
		for (let offset = 0; offset < count; offset += 2000) {
			const batch = ids.slice(offset, offset + 2000);
			await source.query(
				"INSERT INTO tenancy.resource_registry(id,organization_id,resource_type) SELECT id,$1,'project' FROM unnest($2::uuid[]) id",
				[org, batch],
			);
			await source.query(
				"INSERT INTO tenancy.projects(id,organization_id,name,slug,description,owner_membership_id) SELECT id,$1,'Synthetic Project','p-'||id,'Synthetic benchmark content',$3 FROM unnest($2::uuid[]) id",
				[org, batch, memberships[index][0]],
			);
			await source.query(
				"INSERT INTO tenancy.resource_grants(id,organization_id,resource_id,relation,membership_id) SELECT gen_random_uuid(),$1,id,'manager',$3 FROM unnest($2::uuid[]) id",
				[org, batch, memberships[index][0]],
			);
		}
		await source.query(
			"INSERT INTO tenancy.capacity_buckets(id,organization_id,feature,policy_kind,capacity,consumed) VALUES($1,$2,'projects.max_active','unlimited',NULL,$3)",
			[randomUUID(), org, count],
		);
	}
	await source.query(
		"INSERT INTO tenancy.resource_grants(id,organization_id,resource_id,relation,membership_id) SELECT gen_random_uuid(),$1,id,'viewer',$3 FROM unnest($2::uuid[]) id",
		[
			organizations[0],
			projectIds[0].filter((_, i) => i % 100 === 0),
			memberships[0][1],
		],
	);
	// Pinned better-call1.4.0 signs cookie values as HMAC-SHA256/base64, then percent encodes token.signature.
	const epoch = (
		await source.query("SELECT recovery_epoch FROM foundation.installation")
	).rows[0].recovery_epoch;
	for (let tenant = 0; tenant < tenants; tenant++)
		for (const index of tenant === 0 ? [0, 1, 2] : [0, 2]) {
			const userId = users[tenant][index],
				token = randomUUID();
			await source.query(
				"INSERT INTO identity.session(id,user_id,token,expires_at,authentication_method,authenticated_at,user_verified,mfa,recovery_epoch) VALUES($1,$2,$3,clock_timestamp()+interval '2 hours','passkey',clock_timestamp(),true,true,$4)",
				[randomUUID(), userId, token, epoch],
			);
			const signature = createHmac("sha256", f.installation.env.AUTH_SECRET)
				.update(token)
				.digest("base64");
			cookies.set(
				userId,
				`better-auth.session_token=${encodeURIComponent(`${token}.${signature}`)}`,
			);
		}
	await source.query("COMMIT");
	await source.query("ANALYZE tenancy.projects");
	await source.query("ANALYZE tenancy.resource_grants");
	const count = (
		await source.query("SELECT count(*)::int AS count FROM tenancy.projects")
	).rows[0].count;
	assert.equal(count, resourceCount);
	const verified = await applicationRuntime().identity.session(
		new Headers({ cookie: cookies.get(users[0][0]) ?? "" }),
	);
	assert.equal(
		verified?.userId,
		users[0][0],
		"Seeded session must pass the real identity adapter",
	);
	storageBefore = await storageSnapshot();
	graphBefore = await graphSnapshot();
	assert.equal(graphBefore.verifiedEmpty, true);
	stage = "warmup";
	console.log(
		`Seed complete. Warm-up ${warmupMs / 1000}s; measurement ${durationMs / 1000}s, 50 clients, no retries.`,
	);
	const phaseStart = performance.now(),
		measureStart = phaseStart + warmupMs,
		end = measureStart + durationMs;
	measureStartedAt = measureStart;
	let lastEventLoopProbeAt = performance.now();
	const inspectEventLoopLag = () => {
		const now = performance.now();
		const lag = Math.max(0, now - lastEventLoopProbeAt - eventLoopProbeMs);
		lastEventLoopProbeAt = now;
		maxEventLoopLagMs = Math.max(maxEventLoopLagMs, lag);
		if (lag > eventLoopStallLimitMs && !interrupted) {
			interrupted = "event_loop_stall";
			console.log(
				JSON.stringify({
					event: "benchmark.interrupted",
					reason: interrupted,
					lagMs: lag,
					stage,
				}),
			);
		}
	};
	const eventLoopProbe = setInterval(inspectEventLoopLag, eventLoopProbeMs);
	let checkpoint = Promise.resolve();
	const progress = setInterval(() => {
		checkpoint = checkpoint
			.then(() => atomicReport(reportPath, partialEvidence()))
			.catch(() => {
				interrupted = "checkpoint_failure";
			});
		console.log(
			JSON.stringify({
				elapsedSeconds: Math.max(0, (performance.now() - measureStart) / 1000),
				attempts,
				successes,
				failures,
			}),
		);
	}, 30_000);
	try {
		await Promise.all(
			Array.from({ length: clients }, async (_, clientIndex) => {
				const resources = resourceApi(clientIndex % 2 === 0 ? "rpc" : "rest");
				let sequence = clientIndex,
					random = clientIndex + 1701;
				const versions = new Map<number, number>();
				const created = new Map<number, { id: string; version: number }>();
				const grants = new Map<number, string>();
				const cursors = new Map<
					string,
					{ value: string; receivedAt: number }
				>();
				while (!interrupted && performance.now() < end) {
					random ^= random << 13;
					random ^= random >>> 17;
					random ^= random << 5;
					const tenant =
						(random >>> 0) % 10 < 8 ? 0 : 1 + ((random >>> 8) % 99);
					const org = organizations[tenant],
						actor = actors[tenant][0],
						id = projectIds[tenant][clientIndex + 1];
					const slot = sequence++ % 10;
					const metric = slot < 6 ? read : write;
					const measured = performance.now() >= measureStart;
					if (measured) {
						measuring = true;
						stage = "measurement";
						attempts++;
						if (tenant === 0) hotRequests++;
					}
					let operation = "read";
					const begin = performance.now();
					try {
						if (slot < 4) await resources.getProject(actor, org, { id });
						else if (slot < 6) {
							operation = "list";
							const sparse = slot === 5 && tenant === 0;
							if (measured && sparse) sparseLists++;
							const cursorKey = `${tenant}:${sparse}`;
							const cursor = cursors.get(cursorKey);
							// Cold tenants can be idle beyond the API's 15-minute cursor TTL.
							// Start a fresh scan proactively; never retry a failed request.
							if (
								cursor &&
								performance.now() - cursor.receivedAt >= cursorIdleLimitMs
							) {
								cursors.delete(cursorKey);
								if (measured) idleCursorResets++;
							}
							const page = await resources.listProjects(
								sparse ? actors[tenant][1] : actor,
								org,
								{ limit: 10, cursor: cursors.get(cursorKey)?.value },
							);
							if (page.nextCursor)
								cursors.set(cursorKey, {
									value: page.nextCursor,
									receivedAt: performance.now(),
								});
							else cursors.delete(cursorKey);
							if (measured && sparse) sparseRows += page.items.length;
						} else if (slot < 8) {
							operation = "update";
							const result = await resources.updateProject(actor, org, {
								id,
								version: versions.get(tenant) ?? 1,
								name: `Synthetic ${clientIndex} ${sequence}`,
							});
							versions.set(tenant, result.version);
						} else if (slot === 8) {
							const pending = created.get(tenant);
							if (pending) {
								operation = "delete";
								await resources.deleteProject(actor, org, {
									...pending,
									operationKey: randomUUID(),
								});
								created.delete(tenant);
								if (measured) readiness.push(performance.now() - begin);
							} else {
								operation = "create";
								const result = await resources.createProject(actor, org, {
									name: "Created under load",
									slug: `p-${randomUUID()}`,
									operationKey: randomUUID(),
								});
								created.set(tenant, { id: result.id, version: result.version });
								if (measured) readiness.push(performance.now() - begin);
								await resources.getProject(actor, org, { id: result.id });
								if (measured) readable.push(performance.now() - begin);
							}
						} else {
							const grant = grants.get(tenant);
							if (grant) {
								operation = "revoke";
								await revocationFence.run(true, () =>
									resources.revokeGrant(actor, org, { grantId: grant }),
								);
								grants.delete(tenant);
								if (measured) readiness.push(performance.now() - begin);
								await assert.rejects(
									resources.getProject(actors[tenant][2], org, { id }),
									(error: unknown) =>
										typeof error === "object" &&
										error !== null &&
										"code" in error &&
										error.code === "FORBIDDEN",
								);
								if (measured) revocationDenials++;
								if (measured) revocation.push(performance.now() - begin);
							} else {
								operation = "share";
								const result = await resources.grant(actor, org, {
									resourceId: id,
									subject: { kind: "membership", id: memberships[tenant][2] },
									relation: "viewer",
									operationKey: randomUUID(),
								});
								grants.set(tenant, result.id);
								const shared = await resources.getProject(
									actors[tenant][2],
									org,
									{ id },
								);
								assert.equal(shared.id, id);
								if (measured) shareConfirmations++;
								if (measured) readiness.push(performance.now() - begin);
							}
						}
						if (measured) successes++;
					} catch (error) {
						if (!measured) warmupFailures++;
						if (measured) {
							const name = error instanceof Error ? error.name : "Unknown";
							failures[name] = (failures[name] ?? 0) + 1;
							const fields = error as {
								code?: unknown;
								status?: unknown;
							} | null;
							const code =
								typeof fields?.code === "string" &&
								/^[A-Z0-9_]{1,40}$/.test(fields.code)
									? fields.code
									: "UNCLASSIFIED";
							const status =
								typeof fields?.status === "number" &&
								Number.isInteger(fields.status) &&
								fields.status >= 100 &&
								fields.status <= 599
									? String(fields.status)
									: "unavailable";
							failureCodes[code] = (failureCodes[code] ?? 0) + 1;
							failureStatuses[status] = (failureStatuses[status] ?? 0) + 1;
							failuresByOperation[operation] =
								(failuresByOperation[operation] ?? 0) + 1;
						}
					} finally {
						if (measured) {
							metric.push(performance.now() - begin);
							operationCounts[operation] =
								(operationCounts[operation] ?? 0) + 1;
						}
					}
				}
			}),
		);
	} finally {
		inspectEventLoopLag();
		clearInterval(eventLoopProbe);
		clearInterval(progress);
		measuring = false;
		await checkpoint;
	}
	const measurementEndedAt = performance.now();
	stage = "evidence";
	const storageAfter = await storageSnapshot(),
		graphAfter = await graphSnapshot(),
		sourceAfter = await fingerprint();
	const totalSeconds = (measurementEndedAt - measureStart) / 1000;
	const readStats = stats(read),
		writeStats = stats(write),
		fenceStats = stats(fenceWait),
		createStats = stats(readable);
	const successRate = attempts ? successes / attempts : 0;
	const passed =
		!interrupted &&
		partialEvidence().authorizationChanges.valid &&
		graphAfter.verifiedEmpty &&
		measuredFgaWrites === 0 &&
		contextualTupleCounts.length === measuredFgaChecks &&
		sourceAfter.sha256 === sourceBefore.sha256 &&
		successRate >= 0.999 &&
		readStats.p95 < 500 &&
		writeStats.p95 < 800 &&
		fenceStats.p95 < 100 &&
		createStats.p95 < 2000 &&
		stats(readiness).p95 < 2000 &&
		revocationDenials > 0;
	const evidence = {
		...partialEvidence(),
		status: interrupted ? "interrupted" : passed ? "passed" : "failed",
		source: {
			...buildMetadata,
			sourceAfter,
			sourceStable: sourceAfter.sha256 === sourceBefore.sha256,
		},
		storage: {
			before: storageBefore,
			after: storageAfter,
			applicationGrowthBytes:
				Number(storageAfter.application.database_bytes) -
				Number(storageBefore.application.database_bytes),
			applicationClusterWalGrowthBytes: (
				BigInt(storageAfter.application.wal_position_bytes) -
				BigInt(storageBefore.application.wal_position_bytes)
			).toString(),
			controlGrowthBytes:
				Number(storageAfter.control.database_bytes) -
				Number(storageBefore.control.database_bytes),
			controlClusterWalGrowthBytes: (
				BigInt(storageAfter.control.wal_position_bytes) -
				BigInt(storageBefore.control.wal_position_bytes)
			).toString(),
			measuredInterval: "after seed, including warmup and measured traffic",
		},
		scope: smoke
			? "smoke only; does not satisfy R-AUTHZ-PERF"
			: "R-AUTHZ-PERF actual in-process Project API (25 RPC +25 REST clients); real signed Better Auth sessions; excludes TCP/Next wrapper",
		startedAt: started.toISOString(),
		endedAt: new Date().toISOString(),
		durationSeconds: totalSeconds,
		warmupMs,
		clients,
		tenants,
		memberships: 1000,
		projects: resourceCount,
		workloadVersion: "direct-project-v1",
		hotTenant: {
			resources: 50000,
			trafficPercent: 80,
			actualTrafficPercent: (100 * hotRequests) / attempts,
			sparseAccessPercent: 1,
		},
		sparseLists,
		sparseRows,
		revocationDenials,
		mix: operationCounts,
		attempts,
		successes,
		firstAttemptSuccessRate: successRate,
		eventualSuccessRate: successRate,
		retries: 0,
		requestsPerSecond: attempts / totalSeconds,
		failures,
		...(profile
			? {
					sqlProfileScope:
						"Fixture SQL only; production API runtime pools are not instrumented for per-statement profiles.",
					sqlProfile: [...sqlTimings.entries()]
						.map(([statement, values]) => ({
							statement,
							...stats(values),
							total: values.reduce((n, v) => n + v, 0),
						}))
						.sort((a, b) => b.total - a.total),
				}
			: {}),
		latencyMs: {
			read: readStats,
			write: writeStats,
			createToReadable: createStats,
			sourceCommit: stats(readiness),
			fenceWait: fenceStats,
			revocation: stats(revocation),
			revocationFenceWait: stats(revocationFenceWait),
		},
		graph: {
			before: graphBefore,
			after: graphAfter,
			contextualTupleLimitPerDecision: 100,
			submittedContextTupleCounts: stats(contextualTupleCounts),
			measuredCheckRequests: measuredFgaChecks,
			measuredTupleWriteRequests: measuredFgaWrites,
			cleanup:
				"No contextual tuple persistence or generation cleanup work; fixture teardown is not authorization cleanup.",
			persistedTupleWrites: 0,
			projectionAttempts: 0,
			abandonedBuilds: 0,
			cleanupMs: 0,
		},
		hardware: {
			platform: os.platform(),
			arch: os.arch(),
			cpus: os.cpus().length,
			cpu: os.cpus()[0]?.model,
			memoryBytes: os.totalmem(),
			node: process.version,
		},
		pools: {
			web: 8,
			identity: 8,
			control: 8,
			queueWaitIncludedInRequestLatency: true,
		},
		limits: { transactionStatementMs: 8000, lockMs: 5000, fgaMs: 3000 },
	};
	await atomicReport(reportPath, evidence);
	await writeFile(
		`artifacts/phase3/authorization-${smoke ? "smoke" : "benchmark"}.json`,
		`${JSON.stringify(evidence, null, 2)}\n`,
	);
	console.log(JSON.stringify(evidence, null, 2));
	if (!passed) process.exitCode = 1;
} catch (error) {
	await atomicReport(reportPath, {
		...partialEvidence(interrupted ? "interrupted" : "failed"),
		failure: error instanceof Error ? error.name : "Unknown",
	});
	throw error;
} finally {
	fenceChannel.unsubscribe(fenceListener);
	globalThis.fetch = originalFetch;
	await source.query("ROLLBACK").catch(() => {});
	source.release();
	await shutdownApplicationRuntime();
	await f.cleanup();
	for (const [key, value] of Object.entries(originalEnvironment)) {
		if (value === undefined) delete process.env[key];
		else process.env[key] = value;
	}
}

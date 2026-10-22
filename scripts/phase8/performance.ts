import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createHash, createHmac, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import os from "node:os";
import { performance } from "node:perf_hooks";
import { setTimeout as delay } from "node:timers/promises";
import { promisify } from "node:util";
import { createApiClient } from "../../packages/api/src/client";
import type { ProjectDto } from "../../packages/api-contracts/src/index";
import type { TenantActor } from "../../packages/db/src/tenancy";
import { createTestFileStorage } from "../../packages/testing/src/file-storage";
import { sourceFingerprint } from "../phase1/source-fingerprint";
import { resourceFixture } from "../phase3/fixture";
import { evidenceSource, writeEvidence } from "./evidence";
import {
	assertAuthorizedExport,
	assertSparsePage,
	checkFinalPerformanceSource,
	finalPerformanceOutcome,
} from "./performance-assertions";
import { startPerformanceImage } from "./performance-image";
import {
	histogramStatistics,
	performanceGates,
	latencyStatistics as stats,
} from "./performance-metrics";
import {
	createTenantScheduler,
	pollPendingUsage,
} from "./performance-scheduling";

const executeFile = promisify(execFile);
const runId = new Date().toISOString().replace(/[:.]/g, "-");
const evidenceStartedAt = new Date().toISOString();
const evidenceSourceBefore = await evidenceSource();
let interrupted: string | undefined;
let stage = "initialization";
let measureStartedAt: number | undefined;
const operationCounts: Record<string, number> = {};
const failuresByOperation: Record<string, number> = {};
let warmupFailures = 0;
let shareConfirmations = 0;
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
async function dockerCapacity() {
	const raw = await command("docker", [
		"info",
		"--format",
		'{"cpus":{{.NCPU}},"memoryBytes":{{.MemTotal}}}',
	]);
	if (!raw) return { available: false };
	try {
		const data = JSON.parse(raw);
		if (
			!Number.isSafeInteger(data.cpus) ||
			data.cpus < 1 ||
			!Number.isSafeInteger(data.memoryBytes) ||
			data.memoryBytes < 1
		)
			return { available: false };
		return { available: true, cpus: data.cpus, memoryBytes: data.memoryBytes };
	} catch {
		return { available: false };
	}
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
	await mkdir("artifacts/phase8", { recursive: true });
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
	dockerDaemon: await dockerCapacity(),
};
const smoke = process.argv.includes("--smoke");
assert(
	process.argv.slice(2).every((v) => v === "--smoke"),
	"Only --smoke is supported; full reference targets cannot be overridden",
);
const durationMs = smoke ? 30_000 : 30 * 60_000;
const warmupMs = smoke ? 2_000 : 60_000;
const cursorIdleLimitMs = 5 * 60_000;
const eventLoopProbeMs = 1000;
const eventLoopStallLimitMs = 5000;
let maxEventLoopLagMs = 0;
let idleCursorResets = 0;
const clients = 50,
	tenants = 100,
	resourceCount = 100_000;
const read: number[] = [],
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
let measuredFgaChecks = 0;
let measuredFgaWrites = 0;
const f = await resourceFixture({
	defaultProjectCapacity: null,
	// Exercise the ledger and finite quota path throughout the high-volume workload.
	defaultProjectCreatesPerMonth: 1000000,
	// Match packages/api/src/runtime.ts; all 50 clients still submit concurrently.
	poolSize: 8,
}).catch(async () => {
	const path = `artifacts/phase8/performance-initialization-${runId}.json`;
	await atomicReport(path, {
		status: "failed",
		stage: "fixture-initialization",
		runId,
	});
	await writeEvidence(
		{
			gate: smoke ? "performance-smoke" : "performance-full",
			preset: "commercial-local",
			startedAt: evidenceStartedAt,
			source: evidenceSourceBefore,
			outcome: "failed",
			checks: [{ name: "fixture-initialization", passed: false }],
			limitations: smoke
				? ["Smoke cannot satisfy sustained release acceptance"]
				: [],
		},
		[path],
	);
	throw new Error(
		"Performance fixture initialization failed; failed evidence retained",
	);
});
let image: Awaited<ReturnType<typeof startPerformanceImage>> | undefined;
let storage: Awaited<ReturnType<typeof createTestFileStorage>> | undefined;
const benchmarkOrigin = "http://localhost:3000";
const cookies = new Map<string, string>();
const rpcClients = new Map<string, ReturnType<typeof createApiClient>>();
let measurementEndsAt: number | undefined;
let httpAttempts = 0,
	httpTransportFailures = 0;
const httpStatuses: Record<string, number> = {};
async function imageFetch(
	input: Parameters<typeof fetch>[0],
	init?: Parameters<typeof fetch>[1],
) {
	const now = performance.now();
	const measured =
		measureStartedAt !== undefined &&
		measurementEndsAt !== undefined &&
		now >= measureStartedAt &&
		now < measurementEndsAt;
	if (measured) httpAttempts++;
	try {
		const response = await fetch(input, init);
		if (measured)
			httpStatuses[response.status] = (httpStatuses[response.status] ?? 0) + 1;
		return response;
	} catch (error) {
		if (measured) httpTransportFailures++;
		throw error;
	}
}
function rpcClient(actor: TenantActor) {
	let client = rpcClients.get(actor.userId);
	if (!client) {
		client = createApiClient(`${image?.url}/api/rpc`, async (request, init) => {
			const headers = new Headers(
				request instanceof Request ? request.headers : init?.headers,
			);
			headers.set("cookie", cookies.get(actor.userId) ?? "");
			headers.set("origin", benchmarkOrigin);
			return imageFetch(request, {
				...init,
				headers,
				signal: AbortSignal.timeout(30_000),
			});
		});
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
		image?.url,
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
	const response = await imageFetch(url, {
		method,
		headers: {
			cookie: cookies.get(actor.userId) ?? "",
			origin: benchmarkOrigin,
			"content-type": "application/json",
		},
		...(method === "GET" ? {} : { body: JSON.stringify(input) }),
		signal: AbortSignal.timeout(30_000),
	});
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
			"Exact customer image HTTP through TCP, Next wrappers, RPC/REST and verified signed Better Auth sessions",
		attempts,
		successes,
		failures,
		failuresByOperation,
		failureCodes,
		failureStatuses,
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
			createToReadable: stats(readable),
			revocation: stats(revocation),
			sourceCommit: stats(readiness),
		},
	};
}
const reportPath = `artifacts/phase8/performance-${smoke ? "smoke" : "benchmark"}-${runId}.json`;
const organizations = Array.from({ length: tenants }, () => randomUUID());
const users = organizations.map(() =>
	Array.from({ length: 10 }, () => randomUUID()),
);
const memberships = organizations.map(() =>
	Array.from({ length: 10 }, () => randomUUID()),
);
const projectIds: string[][] = [];
const sparsePermittedIds = new Set<string>();
const actors: TenantActor[][] = users.map((group) =>
	group.map((userId) => ({
		userId,
		authenticatedAt: new Date(),
		mfa: true,
		method: "passkey",
	})),
);
const tenantProgress = organizations.map(() => ({
	attempts: 0,
	successes: 0,
	maxGapMs: 0,
	lastSuccessMs: 0,
}));
const usagePending = new Map<number, { key: string; submittedAt: number }>();
const usageVisibility: number[] = [];
const bulkJobs: {
	tenant: number;
	actor: number;
	id: string;
	kind: "projects.import" | "projects.export";
	complete: boolean;
	startedAt: number;
}[] = [];
let commercialFailures = 0;
let completedDuringLoad = 0;
const bulkCompletionMs: number[] = [];
function commercialEvidence() {
	return {
		failures: commercialFailures,
		imports: bulkJobs.filter((j) => j.complete && j.kind === "projects.import")
			.length,
		exports: bulkJobs.filter((j) => j.complete && j.kind === "projects.export")
			.length,
		usageVisibility: stats(usageVisibility),
		completedDuringLoad,
		pending: bulkJobs.filter((j) => !j.complete).length + usagePending.size,
		bulkCompletionMs: stats(bulkCompletionMs),
		cadenceMs: 120000,
		importRows: 20,
		exportAuthorizedRows: 20,
		maxDrainMs: 120000,
		retries: 0,
		configuration: {
			platform: true,
			files: true,
			localUsage: true,
			stripe: false,
			analyticsProvider: false,
		},
		scope:
			"Local Commercial bulk/usage contention; Stripe/PostHog provider throughput is outside this preset",
	};
}
async function launchBulk(round: number) {
	assert(image);
	const organizationId = organizations[0],
		projectId = projectIds[0][0];
	const api = rpcClient(actors[0][0]);
	const csv = Buffer.from(
		`name,slug\n${Array.from({ length: 20 }, (_, i) => `Imported ${round} ${i},perf-import-${round}-${i}`).join("\n")}\n`,
	);
	const uploaded = await api.files.initiate({
		organizationId,
		projectId,
		operationKey: randomUUID(),
		name: "benchmark.csv",
		contentType: "text/csv",
		bytes: csv.byteLength,
		sha256: createHash("sha256").update(csv).digest("hex"),
	});
	await image.upload(uploaded.url, uploaded.headers, csv);
	await api.files.finalize({ organizationId, projectId, id: uploaded.file.id });
	const input = {
		organizationId,
		kind: "projects.import" as const,
		projectId,
		fileId: uploaded.file.id,
		mapping: { name: "name", slug: "slug" },
		duplicates: "reject" as const,
		operationKey: randomUUID(),
	};
	assert(
		(await api.dataJobs.dryRun(input)).every((row) => row.errors.length === 0),
	);
	const imported = await api.dataJobs.start(input);
	bulkJobs.push({
		tenant: 0,
		actor: 0,
		id: imported.id,
		kind: "projects.import",
		complete: false,
		startedAt: performance.now(),
	});
	const tenant = 1 + (round % 99);
	const exported = await rpcClient(actors[tenant][9]).dataJobs.start({
		organizationId: organizations[tenant],
		kind: "projects.export",
		operationKey: randomUUID(),
	});
	bulkJobs.push({
		tenant,
		actor: 9,
		id: exported.id,
		kind: "projects.export",
		complete: false,
		startedAt: performance.now(),
	});
}
async function commercialWork(start: number, end: number) {
	let nextBulkAt = start,
		round = 0;
	try {
		while (!interrupted && performance.now() < end + 120000) {
			const now = performance.now();
			if (now < start) {
				await delay(Math.min(500, start - now));
				continue;
			}
			if (now >= nextBulkAt && now < end - 10000) {
				nextBulkAt += 120000;
				await launchBulk(round++);
			}
			for (const job of bulkJobs.filter((j) => !j.complete)) {
				const api = rpcClient(actors[job.tenant][job.actor]);
				const current = (
					await api.dataJobs.list({ organizationId: organizations[job.tenant] })
				).find((j) => j.id === job.id);
				assert(
					current &&
						current.errors.length === 0 &&
						!["failed", "expired", "canceled"].includes(current.state),
					"Commercial job failed under reference load",
				);
				if (current.state === "complete") {
					assert.equal(current.progress, 20);
					if (job.kind === "projects.export") {
						const download = await api.dataJobs.download({
							organizationId: organizations[job.tenant],
							id: job.id,
						});
						assertAuthorizedExport(
							download,
							new Set(projectIds[job.tenant].slice(100, 120)),
						);
					}
					job.complete = true;
					bulkCompletionMs.push(performance.now() - job.startedAt);
					if (performance.now() < end) completedDuringLoad++;
				}
			}
			await pollPendingUsage(usagePending, async (tenant, pending) => {
				const event = (
					await f.app.query<{ sequence: string }>(
						"SELECT sequence FROM tenancy.usage_events WHERE organization_id=$1 AND operation_key=$2",
						[organizations[tenant], pending.key],
					)
				).rows[0];
				assert(event, "Acknowledged create did not append its usage event");
				const snapshot = await rpcClient(actors[tenant][0]).billing.get({
					organizationId: organizations[tenant],
				});
				if (snapshot.usage.watermark >= Number(event.sequence)) {
					usageVisibility.push(performance.now() - pending.submittedAt);
					usagePending.delete(tenant);
				} else
					assert(
						performance.now() - pending.submittedAt < 60000,
						"Usage visibility deadline exceeded",
					);
			});
			if (
				performance.now() >= end &&
				bulkJobs.every((j) => j.complete) &&
				usagePending.size === 0
			)
				return;
			await delay(2000);
		}
		assert(
			!interrupted &&
				bulkJobs.every((j) => j.complete) &&
				usagePending.size === 0,
			"Commercial jobs did not drain within the declared bound",
		);
	} catch (error) {
		commercialFailures++;
		failures.commercial = (failures.commercial ?? 0) + 1;
		console.log(
			JSON.stringify({
				event: "performance.commercial_failed",
				kind: error instanceof Error ? error.name : "Unknown",
			}),
		);
	}
}
const source = await f.app.connect();
const started = new Date();
let finalChecks: Record<string, boolean> = { execution: false };
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
		if (index > 0)
			await source.query(
				"INSERT INTO tenancy.resource_grants(id,organization_id,resource_id,relation,membership_id) SELECT gen_random_uuid(),$1,id,'viewer',$3 FROM unnest($2::uuid[]) id",
				[org, ids.slice(100, 120), memberships[index][9]],
			);
		await source.query(
			"INSERT INTO tenancy.capacity_buckets(id,organization_id,feature,policy_kind,capacity,consumed) VALUES($1,$2,'projects.max_active','unlimited',NULL,$3)",
			[randomUUID(), org, count],
		);
	}
	for (const id of projectIds[0].filter((_, i) => i % 100 === 0))
		sparsePermittedIds.add(id);
	assert.equal(sparsePermittedIds.size, 500);
	await source.query(
		"INSERT INTO tenancy.resource_grants(id,organization_id,resource_id,relation,membership_id) SELECT gen_random_uuid(),$1,id,'viewer',$3 FROM unnest($2::uuid[]) id",
		[organizations[0], [...sparsePermittedIds], memberships[0][1]],
	);
	// Pinned better-call1.4.0 signs cookie values as HMAC-SHA256/base64, then percent encodes token.signature.
	const epoch = (
		await source.query("SELECT recovery_epoch FROM foundation.installation")
	).rows[0].recovery_epoch;
	for (let tenant = 0; tenant < tenants; tenant++)
		for (const index of tenant === 0 ? [0, 1, 2, 9] : [0, 2, 9]) {
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
	stage = "storage-initialization";
	storage = await createTestFileStorage(benchmarkOrigin);
	const roleUrl = (value: string, role: string) => {
		const url = new URL(value);
		url.username = role;
		return url.toString();
	};
	stage = "image-startup";
	image = await startPerformanceImage({
		...f.installation.env,
		...storage.env,
		PLATFORM_ENABLED: "true",
		BILLING_ENABLED: "false",
		ANALYTICS_ENABLED: "false",
		APP_ENV: "test",
		LIFECYCLE_DATABASE_URL: roleUrl(
			f.installation.env.DATABASE_URL,
			"saas_cook_lifecycle",
		),
		JOURNAL_DATABASE_URL: roleUrl(
			f.installation.env.CONTROL_DATABASE_URL,
			"saas_cook_journal_writer",
		),
		DEFAULT_PROJECT_CAPACITY: "unlimited",
		DEFAULT_PROJECT_CREATES_PER_MONTH: "1000000",
	});
	stage = "identity-verification";
	assert.equal(
		(
			await rpcClient(actors[0][0]).projects.get({
				organizationId: organizations[0],
				id: projectIds[0][0],
			})
		).id,
		projectIds[0][0],
		"The seeded cookie must authenticate through the actual image",
	);
	await assert.rejects(
		createApiClient(`${image.url}/api/rpc`).projects.get({
			organizationId: organizations[0],
			id: projectIds[0][0],
		}),
		(e: unknown) =>
			e instanceof Error && "code" in e && e.code === "UNAUTHORIZED",
	);
	stage = "preflight-snapshots";
	storageBefore = await storageSnapshot();
	graphBefore = await graphSnapshot();
	assert.equal(graphBefore.verifiedEmpty, true);
	stage = "warmup";
	console.log(
		`Seed complete. Warm-up ${warmupMs / 1000}s; measurement ${durationMs / 1000}s, 50 clients, no retries.`,
	);
	const phaseStart = performance.now() + 1000,
		measureStart = phaseStart + warmupMs,
		end = measureStart + durationMs;
	measureStartedAt = measureStart;
	measurementEndsAt = end;
	await image.measure(
		Date.now() + Math.ceil(measureStart - performance.now()),
		Date.now() + Math.ceil(end - performance.now()),
	);
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
	const chooseTenant = createTenantScheduler();
	const commercialTask = commercialWork(measureStart, end);
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
					const tenant = chooseTenant(random);
					const org = organizations[tenant],
						actor = actors[tenant][0],
						id = projectIds[tenant][clientIndex + 1];
					const slot = sequence++ % 10;
					const metric = slot < 6 ? read : write;
					const measured = performance.now() >= measureStart;
					if (measured) {
						stage = "measurement";
						attempts++;
						tenantProgress[tenant].attempts++;
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
							if (sparse) {
								try {
									assertSparsePage(page.items, sparsePermittedIds);
								} catch (error) {
									interrupted = "sparse_authorization_violation";
									throw error;
								}
							}
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
								const operationKey = randomUUID();
								const result = await resources.createProject(actor, org, {
									name: "Created under load",
									slug: `p-${randomUUID()}`,
									operationKey,
								});
								if (measured && !usagePending.has(tenant))
									usagePending.set(tenant, {
										key: `create:${createHash("sha256").update(`user:${actor.userId}:${operationKey}`).digest("hex")}`,
										submittedAt: begin,
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
								await resources.revokeGrant(actor, org, { grantId: grant });
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
						if (measured) {
							successes++;
							const progress = tenantProgress[tenant],
								elapsed = performance.now() - measureStart;
							progress.successes++;
							progress.maxGapMs = Math.max(
								progress.maxGapMs,
								elapsed - progress.lastSuccessMs,
							);
							progress.lastSuccessMs = elapsed;
						}
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
		await checkpoint;
	}
	const measurementEndedAt = performance.now();
	for (const progress of tenantProgress)
		progress.maxGapMs = Math.max(
			progress.maxGapMs,
			durationMs - progress.lastSuccessMs,
		);
	await commercialTask;
	stage = "evidence";
	const storageAfter = await storageSnapshot(),
		graphAfter = await graphSnapshot(),
		sourceAfter = await fingerprint();
	const totalSeconds = (measurementEndedAt - measureStart) / 1000;
	const telemetry = await image.telemetry();
	const webTelemetry = telemetry.find(
		(t: { role: string }) => t.role === "web",
	);
	assert(webTelemetry, "Missing image web telemetry");
	const workerTelemetry = telemetry.find(
		(t: { role: string }) => t.role === "worker",
	);
	assert(workerTelemetry, "Missing image worker telemetry");
	const observerFence = histogramStatistics(
		webTelemetry.fence,
		webTelemetry.maxFence,
	);
	const observerRevocationFence = histogramStatistics(
		webTelemetry.revocationFence,
		webTelemetry.maxRevocationFence,
	);
	const observerTuples = histogramStatistics(webTelemetry.tuples);
	measuredFgaChecks = webTelemetry.checks;
	measuredFgaWrites = webTelemetry.writes + workerTelemetry.writes;
	const readStats = stats(read),
		writeStats = stats(write),
		fenceStats = observerFence,
		createStats = stats(readable);
	const successRate = attempts ? successes / attempts : 0;
	const gates = performanceGates({
		interrupted: Boolean(interrupted),
		authorizationValid: partialEvidence().authorizationChanges.valid,
		graphEmpty: graphAfter.verifiedEmpty,
		sourceStable: sourceAfter.sha256 === sourceBefore.sha256,
		durationMs: measurementEndedAt - measureStart,
		requiredDurationMs: durationMs,
		attempts,
		successes,
		read: readStats,
		write: writeStats,
		fence: fenceStats,
		create: createStats,
		sourceCommit: stats(readiness),
		revocation: stats(revocation),
		observerValid:
			webTelemetry.malformed === 0 &&
			workerTelemetry.malformed === 0 &&
			workerTelemetry.writes === 0 &&
			(histogramStatistics(workerTelemetry.tuples).max ?? 0) <= 100 &&
			observerTuples.count === measuredFgaChecks &&
			measuredFgaChecks > 0 &&
			measuredFgaWrites === 0 &&
			(observerTuples.max ?? Infinity) <= 100,
		revocationFence: observerRevocationFence,
		sparseLists,
		sparseRows,
		tenants: tenantProgress,
		hotRequests,
		operations: operationCounts,
		commercial: commercialEvidence(),
		smoke,
	});
	finalChecks = { ...gates, cleanSource: smoke || !evidenceSourceBefore.dirty };
	const passed = Object.values(finalChecks).every(Boolean);
	const evidence = {
		...partialEvidence(),
		gates,
		image: image.metadata,
		commercial: commercialEvidence(),
		tenantProgress,
		telemetry,
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
			: "R-AUTHZ-PERF actual customer image HTTP (25 RPC +25 REST clients); verified Better Auth sessions; includes TCP/Next wrappers and Commercial contention",
		startedAt: started.toISOString(),
		endedAt: new Date().toISOString(),
		durationSeconds: totalSeconds,
		warmupMs,
		clients,
		tenants,
		memberships: 1000,
		projects: resourceCount,
		workloadVersion: "direct-project-http-commercial-v1",
		acceptanceEligible: passed && !smoke && !evidenceSourceBefore.dirty,
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
		operationsPerSecond: attempts / totalSeconds,
		requestsPerSecond: httpAttempts / totalSeconds,
		http: {
			attempts: httpAttempts,
			statuses: httpStatuses,
			transportFailures: httpTransportFailures,
			supplementalRequestsIncluded: true,
		},
		availabilityScope:
			"First attempt reference logical operations including confirmation reads; expected revocation denials counted separately; no retries",
		failures,
		latencyMs: {
			read: readStats,
			write: writeStats,
			createToReadable: createStats,
			sourceCommit: stats(readiness),
			fenceWait: fenceStats,
			revocation: stats(revocation),
			revocationFenceWait: observerRevocationFence,
		},
		graph: {
			before: graphBefore,
			after: graphAfter,
			contextualTupleLimitPerDecision: 100,
			submittedContextTupleCounts: observerTuples,
			measuredCheckRequests: measuredFgaChecks,
			measuredTupleWriteRequests: measuredFgaWrites,
			worker: {
				checkRequests: workerTelemetry.checks,
				tupleWriteRequests: workerTelemetry.writes,
				contextTuples: histogramStatistics(workerTelemetry.tuples),
				fenceWait: histogramStatistics(
					workerTelemetry.fence,
					workerTelemetry.maxFence,
				),
			},
			cleanup:
				"No contextual tuple persistence or generation cleanup work; fixture teardown is not authorization cleanup.",
			persistedTupleWrites: measuredFgaWrites,
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
			dockerDaemon: buildMetadata.dockerDaemon,
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
		`artifacts/phase8/performance-${smoke ? "smoke" : "benchmark"}.json`,
		`${JSON.stringify(evidence, null, 2)}\n`,
	);
	console.log(JSON.stringify(evidence, null, 2));
	if (!passed) process.exitCode = 1;
} catch (error) {
	finalChecks = { ...finalChecks, execution: false };
	await atomicReport(reportPath, {
		...partialEvidence(interrupted ? "interrupted" : "failed"),
		failure: error instanceof Error ? error.name : "Unknown",
	});
	process.exitCode = 1;
} finally {
	let cleanupPassed = true;
	for (const cleanup of [() => image?.stop(), () => storage?.cleanup()]) {
		try {
			await cleanup();
		} catch {
			cleanupPassed = false;
		}
	}
	await source.query("ROLLBACK").catch(() => {});
	source.release();
	try {
		await f.cleanup();
	} catch {
		cleanupPassed = false;
	}
	finalChecks.cleanup = cleanupPassed;
	const finalSource = await checkFinalPerformanceSource(
		evidenceSourceBefore,
		finalChecks.sourceStable === true,
		evidenceSource,
	);
	finalChecks.sourceStable = finalSource.sourceStable;
	const finalReport = JSON.parse(await readFile(reportPath, "utf8"));
	const outcome = finalPerformanceOutcome({
		status: finalReport.status,
		smoke,
		checks: finalChecks,
		cleanupPassed,
	});
	const passed = outcome.status === "passed";
	const completedReport = {
		...finalReport,
		...outcome,
		sourceAfterCleanup: finalSource.sourceAfterCleanup,
	};
	await atomicReport(reportPath, completedReport);
	await atomicReport(
		`artifacts/phase8/performance-${smoke ? "smoke" : "benchmark"}.json`,
		completedReport,
	);
	await writeEvidence(
		{
			gate: smoke ? "performance-smoke" : "performance-full",
			preset: "commercial-local",
			startedAt: evidenceStartedAt,
			source: evidenceSourceBefore,
			...(image
				? {
						image: {
							id: image.metadata.id,
							architecture: image.metadata.architecture,
							os: image.metadata.os,
							revision: image.metadata.revision,
							fingerprint: image.metadata.sourceFingerprint,
						},
					}
				: {}),
			outcome: passed ? "passed" : "failed",
			checks: Object.entries(finalChecks).map(([name, passed]) => ({
				name,
				passed,
			})),
			limitations: [
				"Read-only aggregate observer adds measured overhead",
				"External provider throughput excluded from Commercial local preset",
				...(smoke ? ["Smoke cannot satisfy sustained release acceptance"] : []),
			],
		},
		[reportPath],
	);
	if (!passed) process.exitCode = 1;
}

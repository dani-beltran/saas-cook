import { createHash, randomUUID } from "node:crypto";
import {
	type BulkInput,
	bulkInput,
} from "@saas-cook/api-contracts/inputs/data-jobs";
import type { Pool, PoolClient } from "pg";

export type { BulkInput } from "@saas-cook/api-contracts/inputs/data-jobs";

import type { createFileService } from "../files/service";
import type { FileStorage, StoredObject } from "../files/storage";
import { privatePayloads } from "../platform/crypto";
import {
	type createResourceService,
	ResourceError,
	type ResourceHooks,
	reserveCapacity,
	settleCapacityReservation,
} from "../resources";
import {
	appendTenantAudit,
	type TenantActor,
	withTenantTransaction,
} from "../tenancy";
import { csvDocument, mappedProjects } from "./csv";

type Actor = TenantActor & { sessionId: string; recoveryEpoch: string };
type Job = {
	id: string;
	organization_id: string;
	requester_id: string;
	session_id: string;
	epoch: string;
	kind: BulkInput["kind"];
	input: BulkInput;
	input_hash: string;
	state: string;
	progress: number;
	total: number;
	errors: { row: number; code: string }[];
	manifest: {
		id: string;
		version: number;
		kind?: "project" | "customer" | "organization" | "file";
	}[];
	available_at: Date;
	draft: string | null;
	object: StoredObject | null;
	reservation_id: string | null;
	expires_at: Date;
};
const dto = (r: Job) => ({
	id: r.id,
	kind: r.kind,
	state: r.state,
	progress: r.progress,
	total: r.total,
	errors: r.errors,
	expiresAt: r.expires_at.toISOString(),
});
const hash = (v: unknown) =>
	createHash("sha256").update(JSON.stringify(v)).digest("hex");
export function createBulkService(
	pool: Pool,
	hooks: ResourceHooks,
	options: {
		secret: string;
		files: ReturnType<typeof createFileService>;
		storage?: FileStorage;
		resources: ReturnType<typeof createResourceService>;
		resolveActor: (sessionId: string, userId: string) => Promise<Actor>;
		ready: (c: PoolClient) => Promise<{ epoch: string }>;
		auditExport: (
			c: PoolClient,
			a: TenantActor,
			org: string,
		) => Promise<unknown[]>;
	},
) {
	const crypto = privatePayloads(options.secret);
	function actor(a: TenantActor): asserts a is Actor {
		if (
			"kind" in a ||
			!("sessionId" in a) ||
			typeof a.sessionId !== "string" ||
			!("recoveryEpoch" in a) ||
			typeof a.recoveryEpoch !== "string" ||
			!a.assertCurrent
		)
			throw new ResourceError("DENIED");
	}
	function tx<T>(
		a: TenantActor,
		org: string,
		exclusive: boolean,
		work: (c: PoolClient) => Promise<T>,
	) {
		return withTenantTransaction(
			pool,
			org,
			[a.userId],
			exclusive,
			work,
			undefined,
			false,
		);
	}
	async function authorize(
		c: PoolClient,
		a: TenantActor,
		org: string,
		kind: BulkInput["kind"],
	) {
		await hooks.authorize(
			c,
			a,
			org,
			{ type: "organization", id: org },
			kind === "projects.import"
				? "create"
				: kind === "projects.export"
					? "read"
					: "manage",
		);
	}
	async function readJob(
		c: PoolClient,
		a: TenantActor,
		org: string,
		id: string,
	) {
		const job = (
			await c.query<Job>(
				"SELECT * FROM tenancy.bulk_jobs WHERE organization_id=$1 AND id=$2 AND requester_id=$3",
				[org, id, a.userId],
			)
		).rows[0];
		if (!job) throw new ResourceError("NOT_FOUND");
		await authorize(c, a, org, job.kind);
		return job;
	}
	async function inspect(a: TenantActor, org: string, input: BulkInput) {
		if (!input.fileId || !input.projectId || !input.mapping)
			throw new ResourceError("INVALID");
		const file = await options.files.download(
			a,
			org,
			input.projectId,
			input.fileId,
		);
		const rows = mappedProjects(
			Buffer.from(file.base64, "base64").toString("utf8"),
			input.mapping,
		);
		await tx(a, org, false, async (c) => {
			await authorize(c, a, org, "projects.import");
			const existing = (
				await c.query<{ slug: string }>(
					"SELECT slug FROM tenancy.projects WHERE organization_id=$1 AND slug=ANY($2::text[])",
					[org, rows.map((r) => r.slug)],
				)
			).rows;
			const duplicates = new Set(existing.map((r) => r.slug));
			for (const r of rows)
				if (duplicates.has(r.slug) && !r.errors.includes("duplicate"))
					r.errors.push("duplicate");
		});
		return rows;
	}
	const service = {
		async dryRun(a: TenantActor, org: string, raw: BulkInput) {
			const i = bulkInput.parse(raw);
			return (await inspect(a, org, i)).map((r) => ({
				row: r.row,
				errors: r.errors,
			}));
		},
		async start(a: TenantActor, org: string, raw: BulkInput) {
			actor(a);
			const i = bulkInput.parse(raw);
			if (!options.storage?.writeExport) throw new ResourceError("DISABLED");
			let total = 0;
			if (i.kind === "projects.import") {
				const rows = await inspect(a, org, i);
				if (
					rows.some((r) =>
						r.errors.some((e) => e !== "duplicate" || i.duplicates !== "skip"),
					)
				)
					throw new ResourceError("INVALID");
				total = rows.length;
			}
			return tx(a, org, true, async (c) => {
				await authorize(c, a, org, i.kind);
				if (i.projectId)
					await hooks.authorize(
						c,
						a,
						org,
						{ type: "project", id: i.projectId },
						"read",
					);
				if (i.kind === "audit.export") await options.auditExport(c, a, org);
				const old = (
					await c.query<Job>(
						"SELECT * FROM tenancy.bulk_jobs WHERE organization_id=$1 AND requester_id=$2 AND operation_key=$3",
						[org, a.userId, i.operationKey],
					)
				).rows[0];
				if (old) {
					if (old.input_hash !== hash(i)) throw new ResourceError("CONFLICT");
					return dto(old);
				}
				if (
					(
						await c.query(
							"SELECT count(*)::int AS n FROM tenancy.bulk_jobs WHERE organization_id=$1 AND state<>'expired'",
							[org],
						)
					).rows[0].n >= 20
				)
					throw new ResourceError("CAPACITY");
				const id = randomUUID();
				await c.query(
					"INSERT INTO tenancy.capacity_buckets(id,organization_id,feature,policy_kind,capacity) VALUES($1,$2,'bulk.bytes','limited',20971520) ON CONFLICT(organization_id,feature) DO NOTHING",
					[randomUUID(), org],
				);
				const reservation = await reserveCapacity(
					c,
					org,
					"bulk.bytes",
					id,
					1048576,
					new Date(Date.now() + 86400000),
				);
				const r = (
					await c.query<Job>(
						"INSERT INTO tenancy.bulk_jobs(id,organization_id,requester_id,session_id,epoch,operation_key,input_hash,kind,input,total,reservation_id,expires_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,clock_timestamp()+interval '24 hours') RETURNING *",
						[
							id,
							org,
							a.userId,
							a.sessionId,
							a.recoveryEpoch,
							i.operationKey,
							hash(i),
							i.kind,
							JSON.stringify(i),
							total,
							reservation,
						],
					)
				).rows[0];
				await appendTenantAudit(
					c,
					org,
					a.userId,
					"bulk.requested",
					id,
					{ kind: i.kind },
					undefined,
				);
				return dto(r);
			});
		},
		async list(a: TenantActor, org: string) {
			return tx(a, org, false, async (c) => {
				await hooks.authorize(
					c,
					a,
					org,
					{ type: "organization", id: org },
					"read",
				);
				return (
					await c.query<Job>(
						"SELECT * FROM tenancy.bulk_jobs WHERE organization_id=$1 AND requester_id=$2 AND state<>'expired' ORDER BY created_at DESC LIMIT 20",
						[org, a.userId],
					)
				).rows.map(dto);
			});
		},
		async cancel(a: TenantActor, org: string, id: string) {
			return tx(a, org, false, async (c) => {
				const r = await readJob(c, a, org, id);
				if (!["pending", "running", "failed"].includes(r.state))
					throw new ResourceError("CONFLICT");
				await c.query(
					"UPDATE tenancy.bulk_jobs SET state='canceled',expires_at=clock_timestamp() WHERE organization_id=$1 AND id=$2",
					[org, id],
				);
				return { canceled: true };
			});
		},
		async resume(a: TenantActor, org: string, id: string) {
			actor(a);
			return tx(a, org, false, async (c) => {
				const r = await readJob(c, a, org, id);
				if (r.state !== "failed" || r.expires_at <= new Date())
					throw new ResourceError("CONFLICT");
				await c.query(
					"UPDATE tenancy.bulk_jobs SET state='pending',session_id=$3,epoch=$4,attempts=0,available_at=clock_timestamp() WHERE organization_id=$1 AND id=$2",
					[org, id, a.sessionId, a.recoveryEpoch],
				);
				return { resumed: true };
			});
		},
		async download(a: TenantActor, org: string, id: string) {
			return tx(a, org, false, async (c) => {
				const r = await readJob(c, a, org, id);
				if (
					r.state !== "complete" ||
					r.expires_at <= new Date() ||
					!r.object ||
					!options.storage
				)
					throw new ResourceError("NOT_FOUND");
				await validateManifest(c, a, org, r);
				const bytes = await options.storage.read(r.object);
				const text = crypto.open(bytes.toString("utf8"), `${org}:${id}`);
				await validateManifest(c, a, org, r);
				await c.query(
					"SELECT set_config('app.authorization_expires_at',least(nullif(current_setting('app.authorization_expires_at',true),'')::timestamptz,$1::timestamptz)::text,true)",
					[r.expires_at],
				);
				await appendTenantAudit(
					c,
					org,
					a.userId,
					"bulk.downloaded",
					id,
					{ kind: r.kind },
					undefined,
				);
				return {
					filename:
						r.kind === "projects.export"
							? "projects.csv"
							: "organization-data.json",
					contentType:
						r.kind === "projects.export" ? "text/csv" : "application/json",
					base64: Buffer.from(text).toString("base64"),
				};
			});
		},
		async run(org: string, id: string) {
			const claim = await pool.connect();
			try {
				if (
					!(
						await claim.query(
							"SELECT pg_try_advisory_lock(hashtextextended($1,0)) AS locked",
							[`bulk:${id}`],
						)
					).rows[0].locked
				)
					return;
				let r = await withTenantTransaction(pool, org, [], false, async (c) => {
					await options.ready(c);
					return (
						await c.query<Job>(
							"SELECT * FROM tenancy.bulk_jobs WHERE organization_id=$1 AND id=$2",
							[org, id],
						)
					).rows[0];
				});
				if (!r) return;
				if (r.available_at > new Date() && r.expires_at > new Date()) return;
				if (r.expires_at <= new Date()) {
					await expire(org, r);
					return;
				}
				if (!["pending", "running"].includes(r.state)) return;
				const a = await options.resolveActor(r.session_id, r.requester_id);
				if (a.recoveryEpoch !== r.epoch) throw new ResourceError("DENIED");
				await tx(a, org, false, async (c) => {
					await readJob(c, a, org, id);
					await c.query(
						"UPDATE tenancy.bulk_jobs SET state='running' WHERE organization_id=$1 AND id=$2 AND state='pending'",
						[org, id],
					);
				});
				if (r.kind === "projects.import") {
					const rows = await inspect(a, org, r.input);
					for (const row of rows.slice(r.progress, r.progress + 20)) {
						const current = await tx(a, org, false, (c) =>
							readJob(c, a, org, id),
						);
						if (current.state !== "running" || current.expires_at <= new Date())
							return;
						let state: "created" | "skipped" | "failed" = "created",
							resourceId: string | null = null,
							code: string | null = null;
						if (row.errors.some((e) => e !== "duplicate")) {
							state = "failed";
							code = "invalid_row";
						} else
							try {
								const created = await options.resources.createProject(a, org, {
									name: row.name,
									slug: row.slug,
									description: row.description,
									operationKey: `bulk:${id}:${row.row}`,
								});
								resourceId = created.id;
							} catch (e) {
								if (
									e instanceof ResourceError &&
									e.code === "CONFLICT" &&
									r.input.duplicates === "skip"
								)
									state = "skipped";
								else throw e;
							}
						await tx(a, org, false, async (c) => {
							await readJob(c, a, org, id);
							await c.query(
								"INSERT INTO tenancy.bulk_rows(organization_id,job_id,row,state,resource_id) VALUES($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING",
								[org, id, row.row, state, resourceId],
							);
							await c.query(
								"UPDATE tenancy.bulk_jobs SET progress=greatest(progress,$3),errors=errors||$4::jsonb WHERE organization_id=$1 AND id=$2",
								[
									org,
									id,
									row.row - 1,
									JSON.stringify(code ? [{ row: row.row, code }] : []),
								],
							);
						});
					}
					await tx(a, org, false, async (c) => {
						const current = await readJob(c, a, org, id);
						if (
							current.progress === rows.length &&
							current.state === "running"
						) {
							await c.query(
								"UPDATE tenancy.bulk_jobs SET state='complete' WHERE organization_id=$1 AND id=$2",
								[org, id],
							);
							await appendTenantAudit(
								c,
								org,
								a.userId,
								"bulk.completed",
								id,
								{ kind: r.kind },
								undefined,
							);
						}
					});
					return;
				}
				if (!r.draft) {
					const projects: Awaited<
						ReturnType<typeof options.resources.listProjects>
					>["items"] = [];
					let cursor: string | undefined;
					for (let page = 0; page < 100; page++) {
						const result = await options.resources.listProjects(a, org, {
							limit: 50,
							...(cursor ? { cursor } : {}),
						});
						projects.push(...result.items);
						if (projects.length > 1000) throw new ResourceError("CAPACITY");
						cursor = result.nextCursor ?? undefined;
						if (!cursor) break;
					}
					if (cursor) throw new ResourceError("CAPACITY");
					const manifest: Job["manifest"] = projects.map((p) => ({
						id: p.id,
						version: p.version,
					}));
					const data = await tx(a, org, false, async (c) => {
						await readJob(c, a, org, id);
						if (r.kind === "audit.export")
							return JSON.stringify({
								version: 1,
								audit: await options.auditExport(c, a, org),
							});
						if (r.kind === "organization.export") {
							const customers = (
								await c.query(
									"SELECT id,name,email,company,status,version FROM tenancy.example_customers WHERE organization_id=$1 AND deleted_at IS NULL ORDER BY id LIMIT 1001",
									[org],
								)
							).rows;
							if (customers.length > 1000) throw new ResourceError("CAPACITY");
							for (const row of customers)
								manifest.push({
									id: row.id,
									version: row.version,
									kind: "customer",
								});
							const revision = (
								await c.query(
									"SELECT desired_revision FROM tenancy.authorization_revisions WHERE organization_id=$1",
									[org],
								)
							).rows[0];
							manifest.push({
								id: org,
								version: Number(revision.desired_revision),
								kind: "organization",
							});
							const members = (
								await c.query(
									"SELECT id,user_id,role,status FROM tenancy.memberships WHERE organization_id=$1 ORDER BY id LIMIT 1001",
									[org],
								)
							).rows;
							const teams = (
								await c.query(
									"SELECT id,name,slug FROM tenancy.teams WHERE organization_id=$1 ORDER BY id LIMIT 1001",
									[org],
								)
							).rows;
							const files = (
								await c.query(
									"SELECT id,project_id,name,bytes FROM tenancy.files WHERE organization_id=$1 AND state='available' AND expires_at>clock_timestamp() ORDER BY id LIMIT 1001",
									[org],
								)
							).rows;
							if ([members, teams, files].some((rows) => rows.length > 1000))
								throw new ResourceError("CAPACITY");
							for (const file of files) {
								await hooks.authorize(
									c,
									a,
									org,
									{ type: "project", id: file.project_id },
									"read",
								);
								manifest.push({ id: file.id, kind: "file", version: 1 });
							}

							const organization = (
								await c.query(
									"SELECT id,name,slug FROM tenancy.organizations WHERE id=$1",
									[org],
								)
							).rows[0];
							return JSON.stringify({
								version: 1,
								organization,
								projects,
								customers,
								members,
								teams,
								files: files.map((f) => ({
									...f,
									downloadPath: `/api/v1/organizations/${org}/projects/${f.project_id}/files/${f.id}/download`,
								})),
								excluded: [
									"credentials",
									"security-audit",
									"financial-retention",
									"file-bytes-download-separately",
								],
							});
						}
						return csvDocument(
							["id", "name", "slug", "description", "status"],
							projects.map((p) => [
								p.id,
								p.name,
								p.slug,
								p.description,
								p.status,
							]),
						);
					});
					if (Buffer.byteLength(data) > 700000)
						throw new ResourceError("CAPACITY");
					const draft = crypto.seal(data, `${org}:${id}`);
					await tx(a, org, false, async (c) => {
						await validateManifest(c, a, org, { ...r, manifest });
						await c.query(
							"UPDATE tenancy.bulk_jobs SET draft=$3,manifest=$4,total=$5 WHERE organization_id=$1 AND id=$2 AND state='running'",
							[org, id, draft, JSON.stringify(manifest), projects.length],
						);
					});
					r = { ...r, draft, manifest, total: projects.length };
				}
				if (!options.storage?.writeExport || !r.draft)
					throw new ResourceError("DISABLED");
				const object = await options.storage.writeExport(
					`quarantine/${org}/${id}`,
					Buffer.from(r.draft),
				);
				await tx(a, org, true, async (c) => {
					const current = await readJob(c, a, org, id);
					if (current.state !== "running" || current.expires_at <= new Date())
						throw new ResourceError("DENIED");
					await validateManifest(c, a, org, current);
					if (current.reservation_id)
						await settleCapacityReservation(
							c,
							org,
							current.reservation_id,
							"committed",
						);
					await c.query(
						"UPDATE tenancy.bulk_jobs SET state='complete',object=$3,draft=NULL,progress=total WHERE organization_id=$1 AND id=$2",
						[org, id, JSON.stringify(object)],
					);
					await appendTenantAudit(
						c,
						org,
						a.userId,
						"bulk.completed",
						id,
						{ kind: r.kind },
						undefined,
					);
				});
			} catch (error) {
				const retry =
					!(error instanceof ResourceError) &&
					!(
						error instanceof Error &&
						/denied|expired|principal|session|epoch/i.test(error.message)
					);
				await withTenantTransaction(pool, org, [], false, (c) =>
					c.query(
						"UPDATE tenancy.bulk_jobs SET state=CASE WHEN $4 AND attempts<4 THEN 'pending' ELSE 'failed' END,attempts=attempts+1,available_at=clock_timestamp()+make_interval(secs=>LEAST(300,15*power(2,attempts)::int)+floor(random()*10)::int),errors=$3 WHERE organization_id=$1 AND id=$2 AND state IN ('pending','running')",
						[
							org,
							id,
							JSON.stringify([
								{
									row: 0,
									code: retry ? "provider_retry" : "access_or_capacity_changed",
								},
							]),
							retry,
						],
					),
				);
			} finally {
				await claim
					.query("SELECT pg_advisory_unlock(hashtextextended($1,0))", [
						`bulk:${id}`,
					])
					.catch(() => {});
				claim.release();
			}
		},
	};
	async function validateManifest(
		c: PoolClient,
		a: TenantActor,
		org: string,
		r: Job,
	) {
		await authorize(c, a, org, r.kind);
		if (r.kind === "audit.export") await options.auditExport(c, a, org);
		for (const item of r.manifest) {
			if (item.kind === "customer") {
				if (
					!(
						await c.query(
							"SELECT 1 FROM tenancy.example_customers WHERE organization_id=$1 AND id=$2 AND version=$3 AND deleted_at IS NULL",
							[org, item.id, item.version],
						)
					).rowCount
				)
					throw new ResourceError("CONFLICT");
				continue;
			}
			if (item.kind === "organization") {
				if (
					!(
						await c.query(
							"SELECT 1 FROM tenancy.authorization_revisions WHERE organization_id=$1 AND desired_revision=$2",
							[org, item.version],
						)
					).rowCount
				)
					throw new ResourceError("CONFLICT");
				continue;
			}
			if (item.kind === "file") {
				const file = (
					await c.query(
						"SELECT project_id FROM tenancy.files WHERE organization_id=$1 AND id=$2 AND state='available' AND expires_at>clock_timestamp()",
						[org, item.id],
					)
				).rows[0];
				if (!file) throw new ResourceError("CONFLICT");
				await hooks.authorize(
					c,
					a,
					org,
					{ type: "project", id: file.project_id },
					"read",
				);
				continue;
			}

			await hooks.authorize(
				c,
				a,
				org,
				{ type: "project", id: item.id },
				"read",
			);
			if (
				!(
					await c.query(
						"SELECT 1 FROM tenancy.projects WHERE organization_id=$1 AND id=$2 AND version=$3 AND deleted_at IS NULL",
						[org, item.id, item.version],
					)
				).rowCount
			)
				throw new ResourceError("CONFLICT");
		}
	}
	async function expire(org: string, r: Job) {
		if (!options.storage) return;
		await options.storage.clearAttempt(
			`staging/${org}/${r.id}`,
			`quarantine/${org}/${r.id}`,
		);
		await withTenantTransaction(pool, org, [], true, async (c) => {
			await options.ready(c);
			if (r.reservation_id) {
				const v = (
					await c.query(
						"SELECT state,bucket_id,quantity FROM tenancy.capacity_reservations WHERE organization_id=$1 AND id=$2",
						[org, r.reservation_id],
					)
				).rows[0];
				if (v.state === "reserved")
					await settleCapacityReservation(c, org, r.reservation_id, "released");
				else if (v.state === "committed") {
					await c.query(
						"UPDATE tenancy.capacity_buckets SET consumed=consumed-$3 WHERE organization_id=$1 AND id=$2",
						[org, v.bucket_id, v.quantity],
					);
					await c.query(
						"UPDATE tenancy.capacity_reservations SET state='released' WHERE organization_id=$1 AND id=$2",
						[org, r.reservation_id],
					);
				}
			}
			await c.query(
				"UPDATE tenancy.bulk_jobs SET state='expired',draft=NULL,object=NULL,input='{}',manifest='[]' WHERE organization_id=$1 AND id=$2",
				[org, r.id],
			);
		});
	}
	return service;
}

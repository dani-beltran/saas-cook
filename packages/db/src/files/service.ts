import { randomUUID } from "node:crypto";
import { uploadInput } from "@saas-cook/api-contracts/files";
import type { Pool, PoolClient } from "pg";
import {
	ResourceError,
	type ResourceHooks,
	reserveCapacity,
	settleCapacityReservation,
} from "../resources";
import { type TenantActor, withTenantTransaction } from "../tenancy";
import { type FileStorage, type StoredObject, scanText } from "./storage";

interface FileRow {
	id: string;
	project_id: string;
	requester_id: string;
	operation_key: string;
	name: string;
	content_type: "text/plain" | "text/csv";
	bytes: number;
	sha256: string;
	reservation_id: string;
	state: "staging" | "available" | "rejected" | "deleted";
	object: StoredObject | null;
	expires_at: Date;
	created_at: Date;
}
const dto = (r: FileRow) => ({
	id: r.id,
	projectId: r.project_id,
	name: r.name,
	contentType: r.content_type,
	bytes: r.bytes,
	state: r.state,
	expiresAt: r.expires_at.toISOString(),
});
const keys = (org: string, id: string) => ({
	staging: `staging/${org}/${id}`,
	quarantine: `quarantine/${org}/${id}`,
});
/** Files inherit their immutable Project's current read/update permission. Human principals only. */
export function createFileService(
	pool: Pool,
	hooks: Pick<ResourceHooks, "authorize">,
	options: { storage?: FileStorage; capacityBytes?: number } = {},
) {
	const capacity = options.capacityBytes ?? 50 * 1048576;
	if (!Number.isSafeInteger(capacity) || capacity < 0 || capacity > 1000000000)
		throw new Error("Invalid storage capacity");
	function storage() {
		if (!options.storage) throw new ResourceError("DISABLED");
		return options.storage;
	}
	async function transaction<T>(
		actor: TenantActor,
		org: string,
		projectId: string,
		mutate: boolean,
		work: (c: PoolClient) => Promise<T>,
	) {
		if ("kind" in actor || !actor.assertCurrent)
			throw new ResourceError("DENIED");
		return withTenantTransaction(
			pool,
			org,
			[actor.userId],
			mutate,
			async (c) => {
				await hooks.authorize(
					c,
					actor,
					org,
					{ type: "project", id: projectId },
					mutate ? "update" : "read",
				);
				if (
					!(
						await c.query(
							"SELECT 1 FROM tenancy.projects WHERE organization_id=$1 AND id=$2 AND deleted_at IS NULL",
							[org, projectId],
						)
					).rowCount
				)
					throw new ResourceError("NOT_FOUND");
				const result = await work(c);
				await hooks.authorize(
					c,
					actor,
					org,
					{ type: "project", id: projectId },
					mutate ? "update" : "read",
				);
				return result;
			},
		);
	}
	async function row(
		c: PoolClient,
		org: string,
		projectId: string,
		id: string,
	) {
		const r = (
			await c.query<FileRow>(
				"SELECT * FROM tenancy.files WHERE organization_id=$1 AND project_id=$2 AND id=$3",
				[org, projectId, id],
			)
		).rows[0];
		if (!r) throw new ResourceError("NOT_FOUND");
		return r;
	}
	async function boundExpiry(c: PoolClient, expiresAt: Date) {
		await c.query(
			"SELECT set_config('app.authorization_expires_at',least(nullif(current_setting('app.authorization_expires_at',true),'')::timestamptz,$1::timestamptz)::text,true)",
			[expiresAt],
		);
	}

	async function event(
		c: PoolClient,
		actor: TenantActor,
		org: string,
		id: string,
		action: string,
	) {
		const eventId = randomUUID();
		await c.query(
			"INSERT INTO tenancy.audit_events(id,organization_id,actor_id,action,target_id,changes) VALUES($1,$2,$3,$4,$5,'{}')",
			[eventId, org, `user:${actor.userId}`, action, id],
		);
		await c.query(
			"INSERT INTO tenancy.outbox_events(id,organization_id,type,payload) VALUES($1,$2,$3,$4)",
			[eventId, org, action, JSON.stringify({ fileId: id, schemaVersion: 1 })],
		);
	}
	return {
		async list(actor: TenantActor, org: string, projectId: string) {
			return transaction(actor, org, projectId, false, async (c) =>
				(
					await c.query<FileRow>(
						"SELECT * FROM tenancy.files WHERE organization_id=$1 AND project_id=$2 AND state<>'deleted' AND expires_at>clock_timestamp() ORDER BY created_at,id LIMIT 100",
						[org, projectId],
					)
				).rows.map(dto),
			);
		},
		async initiate(actor: TenantActor, org: string, raw: unknown) {
			const parsed = uploadInput.safeParse(raw);
			if (!parsed.success) throw new ResourceError("INVALID");
			const input = parsed.data;
			const adapter = storage();
			return transaction(actor, org, input.projectId, true, async (c) => {
				await adapter.ready();
				let file = (
					await c.query<FileRow>(
						"SELECT * FROM tenancy.files WHERE organization_id=$1 AND requester_id=$2 AND operation_key=$3",
						[org, actor.userId, input.operationKey],
					)
				).rows[0];
				if (file) {
					if (
						file.project_id !== input.projectId ||
						file.name !== input.name ||
						file.sha256 !== input.sha256 ||
						file.bytes !== input.bytes ||
						file.content_type !== input.contentType
					)
						throw new ResourceError("CONFLICT");
					if (
						file.state !== "staging" ||
						Date.now() - file.created_at.getTime() > 10 * 60000
					)
						throw new ResourceError("EXPIRED");
				} else {
					// Physical allocation remains charged until both objects are confirmed removed, even after reservation expiry.
					const allocation = (
						await c.query<{ bytes: string; count: string }>(
							"SELECT coalesce(sum(2*bytes),0)::text AS bytes,count(*)::text AS count FROM tenancy.files WHERE organization_id=$1 AND state<>'deleted'",
							[org],
						)
					).rows[0];
					if (
						Number(allocation.bytes) + 2 * input.bytes > capacity ||
						Number(allocation.count) >= 100
					)
						throw new ResourceError("CAPACITY");
					const id = randomUUID();
					await c.query(
						"INSERT INTO tenancy.capacity_buckets(id,organization_id,feature,policy_kind,capacity) VALUES($1,$2,'files.bytes','limited',$3) ON CONFLICT(organization_id,feature) DO NOTHING",
						[randomUUID(), org, capacity],
					);
					const reservationId = await reserveCapacity(
						c,
						org,
						"files.bytes",
						`file:${id}`,
						2 * input.bytes,
						new Date(Date.now() + 86400000),
					);
					file = (
						await c.query<FileRow>(
							"INSERT INTO tenancy.files(id,organization_id,project_id,requester_id,operation_key,name,content_type,bytes,sha256,reservation_id,expires_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,clock_timestamp()+interval '20 minutes') RETURNING *",
							[
								id,
								org,
								input.projectId,
								actor.userId,
								input.operationKey,
								input.name,
								input.contentType,
								input.bytes,
								input.sha256,
								reservationId,
							],
						)
					).rows[0];
					await event(c, actor, org, id, "file.started");
				}
				const url = await adapter.upload(
					keys(org, file.id).staging,
					file.bytes,
					file.sha256,
					file.content_type,
				);
				return {
					file: dto(file),
					url,
					headers: {
						"content-type": file.content_type,
						"if-none-match": "*" as const,
						"x-amz-checksum-sha256": Buffer.from(file.sha256, "hex").toString(
							"base64",
						),
					},
				};
			});
		},
		async finalize(
			actor: TenantActor,
			org: string,
			projectId: string,
			id: string,
		) {
			const adapter = storage();
			return transaction(actor, org, projectId, true, async (c) => {
				const file = await row(c, org, projectId, id);
				await boundExpiry(c, file.expires_at);
				if (
					file.state === "available" &&
					file.expires_at.getTime() > Date.now()
				)
					return dto(file);
				if (file.state !== "staging" || file.expires_at.getTime() <= Date.now())
					throw new ResourceError("EXPIRED");
				const object = await adapter.capture(
					keys(org, id).staging,
					keys(org, id).quarantine,
					file.bytes,
					file.sha256,
				);
				if (
					object.key !== keys(org, id).quarantine ||
					object.bytes !== file.bytes ||
					object.sha256 !== file.sha256 ||
					!object.version ||
					object.version === "null"
				)
					throw new Error("Invalid captured object");
				const receipt = scanText(await adapter.read(object));
				await hooks.authorize(
					c,
					actor,
					org,
					{ type: "project", id: projectId },
					"update",
				);
				if (receipt.verdict !== "clean") {
					await c.query(
						"UPDATE tenancy.files SET state='rejected',object=$3 WHERE organization_id=$1 AND id=$2",
						[org, id, JSON.stringify({ ...object, scan: receipt })],
					);
					await event(c, actor, org, id, "file.rejected");
					return dto({ ...file, state: "rejected" });
				}
				const valid = (
					await c.query(
						"SELECT state,expires_at>clock_timestamp() AS valid FROM tenancy.capacity_reservations WHERE organization_id=$1 AND id=$2",
						[org, file.reservation_id],
					)
				).rows[0];
				if (!valid?.valid || valid.state === "expired") {
					const replacement = await reserveCapacity(
						c,
						org,
						"files.bytes",
						`refile:${id}:${randomUUID()}`,
						2 * file.bytes,
						new Date(Date.now() + 86400000),
					);
					file.reservation_id = replacement;
				}
				await settleCapacityReservation(
					c,
					org,
					file.reservation_id,
					"committed",
				);
				await c.query(
					"UPDATE tenancy.files SET state='available',object=$3,reservation_id=$4,expires_at=clock_timestamp()+interval '30 days' WHERE organization_id=$1 AND id=$2",
					[
						org,
						id,
						JSON.stringify({ ...object, scan: receipt }),
						file.reservation_id,
					],
				);
				await event(c, actor, org, id, "file.available");
				return dto(await row(c, org, projectId, id));
			});
		},
		async download(
			actor: TenantActor,
			org: string,
			projectId: string,
			id: string,
		) {
			const adapter = storage();
			return transaction(actor, org, projectId, false, async (c) => {
				const file = await row(c, org, projectId, id);
				await boundExpiry(c, file.expires_at);
				if (
					file.state !== "available" ||
					!file.object ||
					file.expires_at.getTime() <= Date.now()
				)
					throw new ResourceError("NOT_FOUND");
				const bytes = await adapter.read(file.object);
				await event(c, actor, org, id, "file.downloaded");
				return { file: dto(file), base64: bytes.toString("base64") };
			});
		},
	};
}

import { createHmac, randomUUID } from "node:crypto";
import { once } from "node:events";
import { createServer } from "node:http";
import { Pool } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { backofficeFixture } from "./fixture";
import { createBackofficeRuntime } from "./runtime";

describe("scoped live organization directory", () => {
	let f: Awaited<ReturnType<typeof backofficeFixture>>;
	let runtime: ReturnType<typeof createBackofficeRuntime>;
	const token = randomUUID();
	const ids = Array.from(
		{ length: 6 },
		(_, index) => `10000000-0000-4000-8000-00000000000${index}`,
	);
	const query = { caseReference: "DIRECTORY-1", pageSize: 1 };
	function req(sessionToken = token) {
		const signature = createHmac("sha256", f.env.BACKOFFICE_AUTH_SECRET)
			.update(sessionToken)
			.digest("base64");
		return new Request(
			`${f.env.BACKOFFICE_ORIGIN}/api/organizations/directory`,
			{
				method: "POST",
				headers: {
					...f.headers(),
					cookie: `backoffice-session=${encodeURIComponent(`${sessionToken}.${signature}`)}`,
				},
			},
		);
	}
	beforeAll(async () => {
		f = await backofficeFixture();
		runtime = createBackofficeRuntime(f.env);
		await f.migration.query(
			`UPDATE operator_identity."user" SET status='active' WHERE id=$1`,
			[f.operatorId],
		);
		await f.migration.query(
			`INSERT INTO operator_identity.session(id,user_id,token,expires_at,epoch,verified) VALUES($1,$2,$3,clock_timestamp()+interval '1 hour',$4,true)`,
			[randomUUID(), f.operatorId, token, f.epoch],
		);
		await f.migration.query("DELETE FROM backoffice.grants");
		for (const [index, id] of ids.entries()) {
			await f.migration.query(
				"INSERT INTO tenancy.organizations(id,name,slug,status) VALUES($1::uuid,$2,$1::text,$3)",
				[id, `Private customer ${index}`, index === 5 ? "suspended" : "active"],
			);
			await f.migration.query(
				"INSERT INTO tenancy.seat_capacities(organization_id,capacity) VALUES($1,5)",
				[id],
			);
			await f.migration.query(
				"INSERT INTO backoffice.grants VALUES($1,$2,$3,$4,'test',clock_timestamp()+interval '1 hour')",
				[randomUUID(), f.operatorId, id, f.epoch],
			);
		}
	});
	beforeEach(async () => {
		await f.migration.query("DELETE FROM backoffice.rate_limits");
	});
	afterAll(async () => {
		await runtime?.close();
		await f?.cleanup();
	});
	it("returns only masked granted fields, stable pages, live timestamps and committed audit", async () => {
		const seen: string[] = [];
		let cursor: string | undefined;
		do {
			const start = Date.now();
			const page = await runtime.directory(req(), { ...query, cursor });
			expect(page.items).toHaveLength(1);
			expect(Object.keys(page.items[0]).sort()).toEqual([
				"id",
				"lifecycle",
				"maskedName",
				"sourceTimestamp",
			]);
			expect(page.items[0].maskedName).toBe("P•••");
			expect(Date.parse(page.items[0].sourceTimestamp)).toBeGreaterThanOrEqual(
				start - 1000,
			);
			expect(page.freshness.kind).toBe("live");
			expect(JSON.stringify(page)).not.toContain("Private customer");
			expect(
				(
					await f.migration.query(
						"SELECT outcome FROM backoffice.audit_events WHERE id=$1",
						[page.auditReference],
					)
				).rows[0].outcome,
			).toBe("allowed");
			seen.push(page.items[0].id);
			cursor = page.nextCursor ?? undefined;
		} while (cursor);
		expect(seen).toEqual(ids);
	});
	it("filters current lifecycle and exact ID without exposing wrong-scope existence; continues empty scans", async () => {
		const first = await runtime.directory(req(), {
			...query,
			lifecycle: "suspended",
		});
		expect(first.items).toEqual([]);
		expect(first.nextCursor).toBeTruthy();
		const second = await runtime.directory(req(), {
			...query,
			lifecycle: "suspended",
			cursor: first.nextCursor,
		});
		expect(second.items.map((item) => item.id)).toEqual([ids[5]]);
		expect(second.nextCursor).toBeNull();
		for (const organizationId of [f.otherOrganizationId, randomUUID()]) {
			const page = await runtime.directory(req(), { ...query, organizationId });
			expect(page.items).toEqual([]);
			expect(page.nextCursor).toBeNull();
		}
		await f.migration.query(
			"UPDATE tenancy.organizations SET status='suspended' WHERE id=$1",
			[ids[0]],
		);
		try {
			expect(
				(
					await runtime.directory(req(), {
						...query,
						organizationId: ids[0],
						lifecycle: "suspended",
					})
				).items[0].lifecycle,
			).toBe("suspended");
		} finally {
			await f.migration.query(
				"UPDATE tenancy.organizations SET status='active' WHERE id=$1",
				[ids[0]],
			);
		}
	});
	it("rejects forged, query-, session- and changed-scope cursors with durable denial audits", async () => {
		const first = await runtime.directory(req(), query);
		for (const extra of [
			{ cursor: "forged" },
			{ cursor: first.nextCursor, lifecycle: "active" },
			{ cursor: first.nextCursor, pageSize: 2 },
			{ cursor: first.nextCursor, caseReference: "OTHER" },
		]) {
			await expect(
				runtime.directory(req(), { ...query, ...extra }),
			).rejects.toThrow("Directory unavailable");
		}
		const oldSession = (
			await f.migration.query(
				"SELECT id FROM operator_identity.session WHERE token=$1",
				[token],
			)
		).rows[0].id;
		await f.migration.query(
			"UPDATE operator_identity.session SET id=$1 WHERE token=$2",
			[randomUUID(), token],
		);
		await expect(
			runtime.directory(req(), { ...query, cursor: first.nextCursor }),
		).rejects.toThrow();
		await f.migration.query(
			"UPDATE operator_identity.session SET id=$1 WHERE token=$2",
			[oldSession, token],
		);
		await f.migration.query(
			"UPDATE backoffice.grants SET expires_at=expires_at+interval '1 minute' WHERE organization_id=$1",
			[ids[0]],
		);
		await expect(
			runtime.directory(req(), { ...query, cursor: first.nextCursor }),
		).rejects.toThrow();
		expect(
			(
				await f.migration.query(
					"SELECT count(*)::int AS n FROM backoffice.audit_events WHERE action='organization.directory' AND outcome='denied'",
				)
			).rows[0].n,
		).toBeGreaterThanOrEqual(6);
	});

	it("rejects another operator's cursor and removes revoked targets from fresh pages", async () => {
		const first = await runtime.directory(req(), query);
		const other = randomUUID(),
			otherToken = randomUUID();
		await f.migration.query(
			`INSERT INTO operator_identity."user"(id,name,email,epoch,status) VALUES($1,'Other staff',$2,$3,'active')`,
			[other, `${other}@example.test`, f.epoch],
		);
		await f.migration.query(
			"INSERT INTO operator_identity.session(id,user_id,token,expires_at,epoch,verified) VALUES($1,$2,$3,clock_timestamp()+interval '1 hour',$4,true)",
			[randomUUID(), other, otherToken, f.epoch],
		);
		await f.migration.query(
			"INSERT INTO backoffice.grants VALUES($1,$2,$3,$4,'test',clock_timestamp()+interval '1 hour')",
			[randomUUID(), other, ids[0], f.epoch],
		);
		await expect(
			runtime.directory(req(otherToken), {
				...query,
				cursor: first.nextCursor,
			}),
		).rejects.toThrow();
		expect(
			(await runtime.directory(req(otherToken), query)).items.map(
				(item) => item.id,
			),
		).toEqual([ids[0]]);
		const revoked = (
			await f.migration.query(
				"DELETE FROM backoffice.grants WHERE user_id=$1 AND organization_id=$2 RETURNING *",
				[f.operatorId, ids[0]],
			)
		).rows[0];
		try {
			await expect(
				runtime.directory(req(), { ...query, cursor: first.nextCursor }),
			).rejects.toThrow();
			expect(
				(await runtime.directory(req(), { ...query, organizationId: ids[0] }))
					.items,
			).toEqual([]);
		} finally {
			await f.migration.query(
				"INSERT INTO backoffice.grants SELECT * FROM json_populate_record(NULL::backoffice.grants,$1::json)",
				[JSON.stringify(revoked)],
			);
		}
	});
	it("enforces actor, epoch and environment RLS during directory mode and keeps business tables private", async () => {
		const pool = new Pool({ connectionString: f.env.BACKOFFICE_DATABASE_URL });
		const c = await pool.connect();
		try {
			await c.query("BEGIN");
			await c.query("SELECT set_config('backoffice.directory','on',true)");
			expect((await c.query("SELECT * FROM backoffice.grants")).rows).toEqual(
				[],
			);
			await c.query(
				"SELECT set_config('backoffice.operator_id',$1,true),set_config('backoffice.epoch',$2,true),set_config('backoffice.environment','test',true)",
				[f.operatorId, f.epoch],
			);
			expect(
				(await c.query("SELECT * FROM backoffice.grants")).rows,
			).toHaveLength(6);
			for (const [key, value] of [
				["operator_id", randomUUID()],
				["epoch", randomUUID()],
				["environment", "production"],
			]) {
				await c.query("SAVEPOINT context");
				await c.query("SELECT set_config($1,$2,true)", [
					`backoffice.${key}`,
					value,
				]);
				expect((await c.query("SELECT * FROM backoffice.grants")).rows).toEqual(
					[],
				);
				await c.query("ROLLBACK TO context");
			}
			await expect(
				c.query("SELECT * FROM tenancy.organizations"),
			).rejects.toMatchObject({ code: "42501" });
		} finally {
			await c.query("ROLLBACK");
			c.release();
			await pool.end();
		}
	});
	it("denies customer sessions, wrong origin, audit failure and publication loss", async () => {
		for (const key of ["cookie", "origin"]) {
			const request = req();
			request.headers.delete(key);
			await expect(runtime.directory(request, query)).rejects.toThrow();
		}
		await f.migration.query(
			"REVOKE INSERT ON backoffice.audit_events FROM saas_cook_bo_query",
		);
		try {
			await expect(runtime.directory(req(), query)).rejects.toThrow();
		} finally {
			await f.migration.query(
				"GRANT INSERT ON backoffice.audit_events TO saas_cook_bo_query",
			);
		}
		await f.control.query("UPDATE control.operator_publications SET epoch=$1", [
			randomUUID(),
		]);
		try {
			await expect(runtime.directory(req(), query)).rejects.toThrow();
		} finally {
			await f.control.query(
				"UPDATE control.operator_publications SET epoch=$1",
				[f.epoch],
			);
		}
	});
	it("keeps the earliest grant expiry across later FGA batches and audits no partial page", async () => {
		let checks = 0;
		const proxy = createServer(async (request, response) => {
			const chunks: Buffer[] = [];
			for await (const chunk of request) chunks.push(Buffer.from(chunk));
			const upstream = await fetch(`${f.env.OPENFGA_API_URL}${request.url}`, {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: Buffer.concat(chunks),
			});
			const body = await upstream.text();
			if (++checks === 2)
				await new Promise((resolve) => setTimeout(resolve, 500));
			response.writeHead(upstream.status, {
				"content-type": "application/json",
			});
			response.end(body);
		});
		proxy.listen(0, "127.0.0.1");
		await once(proxy, "listening");
		const address = proxy.address();
		if (!address || typeof address === "string")
			throw new Error("Missing proxy");
		const delayed = createBackofficeRuntime({
			...f.env,
			OPENFGA_API_URL: `http://127.0.0.1:${address.port}`,
		});
		try {
			await f.migration.query(
				"UPDATE backoffice.grants SET expires_at=clock_timestamp()+interval '350 milliseconds' WHERE organization_id=$1",
				[ids[0]],
			);
			await expect(
				delayed.directory(req(), {
					...query,
					pageSize: 2,
					caseReference: "LATE-PAGE",
				}),
			).rejects.toThrow();
			expect(checks).toBe(2);
			expect(
				(
					await f.migration.query(
						"SELECT count(*)::int AS n FROM backoffice.audit_events WHERE case_reference='LATE-PAGE' AND outcome='allowed'",
					)
				).rows[0].n,
			).toBe(0);
		} finally {
			await f.migration.query(
				"UPDATE backoffice.grants SET expires_at=clock_timestamp()+interval '1 hour' WHERE organization_id=$1",
				[ids[0]],
			);
			await delayed.close();
			proxy.close();
			await once(proxy, "close");
		}
	});
	it("returns an audited empty page for expired scope and denies after offboarding", async () => {
		await f.migration.query(
			"UPDATE backoffice.grants SET expires_at=clock_timestamp()-interval '1 second'",
		);
		expect((await runtime.directory(req(), query)).items).toEqual([]);
		await f.offboard();
		await expect(runtime.directory(req(), query)).rejects.toThrow();
	});
});

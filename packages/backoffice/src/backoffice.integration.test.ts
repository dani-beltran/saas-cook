import { createHmac, randomUUID } from "node:crypto";
import { once } from "node:events";
import { createServer } from "node:http";
import { operatorModelHash } from "@saas-cook/authz/platform";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { backofficeFixture } from "./fixture";
import { createBackofficeRuntime } from "./runtime";

describe("restricted Backoffice metadata boundary", () => {
	let f: Awaited<ReturnType<typeof backofficeFixture>>,
		runtime: ReturnType<typeof createBackofficeRuntime>,
		token: string,
		restoredSession: unknown,
		restoredGrants: unknown[];
	beforeAll(async () => {
		f = await backofficeFixture();
		runtime = createBackofficeRuntime(f.env);
		token = randomUUID();
		await f.migration.query(
			`UPDATE operator_identity."user" SET status='active' WHERE id=$1`,
			[f.operatorId],
		);
		await f.migration.query(
			`INSERT INTO operator_identity.session(id,user_id,token,expires_at,epoch,verified) VALUES($1,$2,$3,clock_timestamp()+interval '1 hour',$4,true)`,
			[randomUUID(), f.operatorId, token, f.epoch],
		);
		restoredSession = (
			await f.migration.query(
				"SELECT row_to_json(s) AS data FROM operator_identity.session s WHERE token=$1",
				[token],
			)
		).rows[0].data;
		restoredGrants = (
			await f.migration.query(
				"SELECT row_to_json(g) AS data FROM backoffice.grants g",
			)
		).rows.map((r) => r.data);
	});
	afterAll(async () => {
		await runtime?.close();
		await f?.cleanup();
	});
	function req(cookie = true) {
		const url = `${f.env.BACKOFFICE_ORIGIN}/api/organizations/lookup`,
			headers = new Headers(f.headers());
		if (cookie) {
			const signature = createHmac("sha256", f.env.BACKOFFICE_AUTH_SECRET)
				.update(token)
				.digest("base64");
			headers.set(
				"cookie",
				`backoffice-session=${encodeURIComponent(`${token}.${signature}`)}`,
			);
		}
		return new Request(url, { method: "POST", headers });
	}
	it("returns only scoped metadata, commits audit, and conceals unknown/wrong scopes", async () => {
		await runtime.ready();
		const result = await runtime
			.lookup(req(), {
				organizationId: f.organizationId,
				caseReference: "TEST-1",
			})
			.catch((e) => {
				throw e.cause ?? e;
			});
		expect(result.name).toBe("Synthetic authorized organization");
		expect(Object.keys(result).sort()).toEqual(
			[
				"id",
				"name",
				"lifecycle",
				"seats",
				"sourceTimestamp",
				"auditReference",
			].sort(),
		);
		expect(
			(
				await f.migration.query(
					"SELECT actor_id,outcome FROM backoffice.audit_events WHERE id=$1",
					[result.auditReference],
				)
			).rows[0],
		).toEqual({ actor_id: f.operatorId, outcome: "allowed" });
		for (const id of [f.otherOrganizationId, randomUUID()])
			await expect(
				runtime.lookup(req(), { organizationId: id, caseReference: "TEST-1" }),
			).rejects.toThrow("Organization unavailable");
	});

	it("keeps admission durable across failures and source-header changes", async () => {
		await f.migration.query("DELETE FROM backoffice.rate_limits");
		await f.migration.query(
			"INSERT INTO backoffice.rate_limits VALUES('public',clock_timestamp(),59)",
		);
		try {
			const first = req(false);
			first.headers.set("x-forwarded-for", "192.0.2.1");
			await expect(
				runtime.identity.withSession(first, async () => "unreachable"),
			).rejects.toThrow("Operator session required");
			const second = req();
			second.headers.set("cf-connecting-ip", "2001:db8::1");
			second.headers.set("x-backoffice-source", "127.0.0.1");
			await expect(
				runtime.identity.withSession(second, async () => "unreachable"),
			).rejects.toThrow("Operator rate limit");
			expect(
				(
					await f.migration.query(
						"SELECT count FROM backoffice.rate_limits WHERE key='public'",
					)
				).rows[0].count,
			).toBe(61);
			await f.migration.query(
				"UPDATE backoffice.rate_limits SET started_at=clock_timestamp()-interval '61 seconds'",
			);
			await expect(
				runtime.identity.withSession(req(), async () => "allowed"),
			).resolves.toBe("allowed");
		} finally {
			await f.migration.query("DELETE FROM backoffice.rate_limits");
		}
	});
	it("denies cross-origin lookup even with a valid staff session", async () => {
		for (const origin of [null, "https://customer.example.test"]) {
			const request = req();
			if (origin) request.headers.set("origin", origin);
			else request.headers.delete("origin");
			await expect(
				runtime.lookup(request, {
					organizationId: f.organizationId,
					caseReference: "ORIGIN",
				}),
			).rejects.toThrow("Organization unavailable");
		}
	});
	it("rejects customer/no session and runtime credential/business/audit rewrite access", async () => {
		await expect(
			runtime.lookup(req(false), {
				organizationId: f.organizationId,
				caseReference: "TEST-2",
			}),
		).rejects.toThrow();
		const customer = req(false);
		customer.headers.set(
			"cookie",
			"better-auth.session_token=synthetic-customer-session",
		);
		await expect(
			runtime.lookup(customer, {
				organizationId: f.organizationId,
				caseReference: "CUSTOMER-COOKIE",
			}),
		).rejects.toThrow();
		const bearer = req();
		bearer.headers.set("authorization", "Bearer synthetic-customer-key");
		await expect(
			runtime.lookup(bearer, {
				organizationId: f.organizationId,
				caseReference: "CUSTOMER-KEY",
			}),
		).rejects.toThrow();
		const p = new Pool({ connectionString: f.env.BACKOFFICE_DATABASE_URL });
		try {
			expect((await p.query("SELECT * FROM backoffice.grants")).rowCount).toBe(
				0,
			);
			for (const sql of [
				'SELECT * FROM identity."user"',
				"SELECT * FROM tenancy.projects",
				"DELETE FROM backoffice.audit_events",
				"UPDATE backoffice.grants SET expires_at=now()",
			])
				await expect(p.query(sql)).rejects.toMatchObject({ code: "42501" });
		} finally {
			await p.end();
		}
	});
	it("denies expired grants, audit outage and independently closed publication", async () => {
		await f.migration.query(
			"UPDATE backoffice.grants SET expires_at=clock_timestamp()-interval '1 second'",
		);
		await expect(
			runtime.lookup(req(), {
				organizationId: f.organizationId,
				caseReference: "TEST-3",
			}),
		).rejects.toThrow();
		await f.migration.query(
			"UPDATE backoffice.grants SET expires_at=clock_timestamp()+interval '1 hour'",
		);
		await f.migration.query(
			"REVOKE INSERT ON backoffice.audit_events FROM saas_cook_bo_query",
		);
		try {
			await expect(
				runtime.lookup(req(), {
					organizationId: f.organizationId,
					caseReference: "TEST-3",
				}),
			).rejects.toThrow();
		} finally {
			await f.migration.query(
				"GRANT INSERT ON backoffice.audit_events TO saas_cook_bo_query",
			);
		}
		await f.control.query(
			"UPDATE control.operator_publications SET model_hash='unavailable'",
		);
		await expect(
			runtime.lookup(req(), {
				organizationId: f.organizationId,
				caseReference: "TEST-3",
			}),
		).rejects.toThrow();
	});
	it("rejects a late real FGA allow after grant expiry and drains before offboarding", async () => {
		await f.control.query(
			"UPDATE control.operator_publications SET model_hash=$1",
			[operatorModelHash],
		);
		const proxy = createServer(async (req, res) => {
			const chunks: Buffer[] = [];
			for await (const chunk of req) chunks.push(Buffer.from(chunk));
			const upstream = await fetch(`${f.env.OPENFGA_API_URL}${req.url}`, {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: Buffer.concat(chunks),
			});
			const body = await upstream.text();
			await new Promise((r) => setTimeout(r, 200));
			res.writeHead(upstream.status, { "content-type": "application/json" });
			res.end(body);
		});
		proxy.listen(0, "127.0.0.1");
		await once(proxy, "listening");
		const address = proxy.address();
		if (!address || typeof address === "string")
			throw new Error("Missing proxy port");
		const delayed = createBackofficeRuntime({
			...f.env,
			OPENFGA_API_URL: `http://127.0.0.1:${address.port}`,
		});
		try {
			await f.migration.query(
				"UPDATE backoffice.grants SET expires_at=clock_timestamp()+interval '100 milliseconds'",
			);
			await expect(
				delayed.lookup(req(), {
					organizationId: f.organizationId,
					caseReference: "LATE-1",
				}),
			).rejects.toThrow();
			expect(
				(
					await f.migration.query(
						"SELECT count(*)::int AS n FROM backoffice.audit_events WHERE case_reference='LATE-1' AND outcome='allowed'",
					)
				).rows[0].n,
			).toBe(0);
			await f.migration.query(
				"UPDATE backoffice.grants SET expires_at=clock_timestamp()+interval '1 hour'",
			);
			let entered: () => void = () => {};
			const started = new Promise<void>((r) => {
				entered = r;
			});
			const read = runtime.identity.withSession(req(), async () => {
				entered();
				await new Promise((r) => setTimeout(r, 100));
				return "drained";
			});
			await started;
			const revoked = f.offboard();
			expect(await read).toBe("drained");
			await revoked;
			await expect(
				runtime.lookup(req(), {
					organizationId: f.organizationId,
					caseReference: "REVOKED-1",
				}),
			).rejects.toThrow();
		} finally {
			await delayed.close();
			proxy.close();
			await once(proxy, "close");
		}
	});
	it("does not renew restored staff authority when the independent epoch changes", async () => {
		// Simulate restored pre-offboarding application rows; the new independent epoch remains authoritative.
		await f.migration.query(
			`UPDATE operator_identity."user" SET status='active' WHERE id=$1`,
			[f.operatorId],
		);
		await f.migration.query(
			"INSERT INTO operator_identity.session SELECT * FROM json_populate_record(NULL::operator_identity.session,$1::json)",
			[JSON.stringify(restoredSession)],
		);
		for (const grant of restoredGrants)
			await f.migration.query(
				"INSERT INTO backoffice.grants SELECT * FROM json_populate_record(NULL::backoffice.grants,$1::json)",
				[JSON.stringify(grant)],
			);
		await expect(
			runtime.lookup(req(), {
				organizationId: f.organizationId,
				caseReference: "RESTORED-BEFORE-EPOCH",
			}),
		).resolves.toMatchObject({ id: f.organizationId });
		const epoch = randomUUID();
		await f.control.query("UPDATE control.installations SET epoch=$1", [epoch]);
		await f.control.query("UPDATE control.operator_publications SET epoch=$1", [
			epoch,
		]);
		await f.migration.query(
			"UPDATE foundation.installation SET recovery_epoch=$1",
			[epoch],
		);
		await expect(
			runtime.lookup(req(), {
				organizationId: f.organizationId,
				caseReference: "RESTORE-1",
			}),
		).rejects.toThrow();
	});
	it("requires exact independent approval scope and one-use receipts for re-enrollment", async () => {
		const epoch = (
			await f.control.query("SELECT epoch FROM control.installations")
		).rows[0].epoch;
		await expect(
			f.manage("reenroll", { epoch, environment: "production" }),
		).rejects.toThrow("Approval scope mismatch");
		await expect(
			f.manage("reenroll", {
				epoch,
				expiresAt: new Date(Date.now() - 1000).toISOString(),
			}),
		).rejects.toThrow("Approval expired");
		const nonce = randomUUID();
		const enrolled = await f.manage("reenroll", { epoch, nonce });
		expect(enrolled.invitation).toBeTruthy();
		await expect(f.manage("reenroll", { epoch, nonce })).rejects.toMatchObject({
			code: "23505",
		});
		expect(
			(
				await f.migration.query(
					"SELECT count(*)::int AS n FROM operator_identity.session WHERE user_id=$1",
					[f.operatorId],
				)
			).rows[0].n,
		).toBe(0);
		expect(
			(
				await f.migration.query(
					`SELECT status,epoch FROM operator_identity."user" WHERE id=$1`,
					[f.operatorId],
				)
			).rows[0],
		).toEqual({ status: "invited", epoch });
		await expect(
			runtime.lookup(req(), {
				organizationId: f.organizationId,
				caseReference: "REENROLL",
			}),
		).rejects.toThrow();
	});
});

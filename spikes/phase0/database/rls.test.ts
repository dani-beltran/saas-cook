import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { tenantTransaction } from "./tenant";

const live = process.env.PHASE0_INTEGRATION === "1";
describe.skipIf(!live)(
	"PostgreSQL restricted-role RLS and pool (R-TENANCY)",
	() => {
		const admin = new Pool({
			connectionString:
				process.env.PHASE0_DATABASE_URL ??
				"postgres://postgres:phase0@127.0.0.1:55432/phase0",
		});
		const runtimeUrl = new URL(
			process.env.PHASE0_DATABASE_URL ??
				"postgres://postgres:phase0@127.0.0.1:55432/phase0",
		);
		runtimeUrl.username = "phase0_runtime";
		runtimeUrl.password = "phase0-runtime";
		const runtime = new Pool({
			connectionString: runtimeUrl.toString(),
			max: 1,
		});
		const a = randomUUID(),
			b = randomUUID(),
			ma = randomUUID(),
			mb = randomUUID();
		const user = randomUUID(),
			pa = randomUUID(),
			pb = randomUUID();
		const scope = <T>(
			org: string,
			fn: Parameters<typeof tenantTransaction<T>>[2],
		) => tenantTransaction(runtime, org, fn);
		beforeAll(async () => {
			await admin.query(
				await readFile(new URL("./schema.sql", import.meta.url), "utf8"),
			);
			await admin.query(
				"INSERT INTO phase0_rls.memberships VALUES ($1,$2,$3,'active'),($4,$5,$3,'active')",
				[ma, a, user, mb, b],
			);
			await admin.query(
				"INSERT INTO phase0_rls.projects VALUES ($1,$2,$3,'A'),($4,$5,$6,'B')",
				[pa, a, ma, pb, b, mb],
			);
		});
		afterAll(async () => {
			await admin.query(
				"DELETE FROM phase0_rls.tasks WHERE organization_id=ANY($1::uuid[])",
				[[a, b]],
			);
			await admin.query(
				"DELETE FROM phase0_rls.projects WHERE organization_id=ANY($1::uuid[])",
				[[a, b]],
			);
			await admin.query(
				"DELETE FROM phase0_rls.memberships WHERE organization_id=ANY($1::uuid[])",
				[[a, b]],
			);
			await Promise.all([runtime.end(), admin.end()]);
		});
		it("connects as a non-owner without privileged role capabilities", async () => {
			const {
				rows: [r],
			} = await runtime.query(
				"SELECT current_user, rolsuper, rolbypassrls, rolcreatedb, rolcreaterole FROM pg_roles WHERE rolname=current_user",
			);
			expect(r).toMatchObject({
				current_user: "phase0_runtime",
				rolsuper: false,
				rolbypassrls: false,
				rolcreatedb: false,
				rolcreaterole: false,
			});
			const { rows } = await admin.query(
				"SELECT relrowsecurity,relforcerowsecurity, pg_get_userbyid(relowner) AS owner FROM pg_class WHERE relnamespace='phase0_rls'::regnamespace AND relkind='r'",
			);
			expect(rows).toHaveLength(3);
			for (const table of rows) {
				expect(table.relrowsecurity && table.relforcerowsecurity).toBe(true);
				expect(table.owner).not.toBe("phase0_runtime");
			}
		});
		it("missing context sees nothing and pool reuse clears committed context", async () => {
			expect(
				(await runtime.query("SELECT * FROM phase0_rls.projects")).rows,
			).toEqual([]);
			expect(
				(await scope(a, (c) => c.query("SELECT name FROM phase0_rls.projects")))
					.rows,
			).toEqual([{ name: "A" }]);
			expect(
				(await scope(b, (c) => c.query("SELECT name FROM phase0_rls.projects")))
					.rows,
			).toEqual([{ name: "B" }]);
			expect(
				(await runtime.query("SELECT * FROM phase0_rls.projects")).rows,
			).toEqual([]);
		});
		it("rollback clears tenant context on the same pooled connection", async () => {
			await expect(
				scope(a, async (c) => {
					await c.query("SELECT * FROM phase0_rls.projects");
					throw new Error("rollback fixture");
				}),
			).rejects.toThrow("rollback fixture");
			expect(
				(await runtime.query("SELECT * FROM phase0_rls.projects")).rows,
			).toEqual([]);
		});
		it("rejects forged inserts, tenant changes and cross-tenant foreign keys", async () => {
			await expect(
				scope(a, (c) =>
					c.query(
						"INSERT INTO phase0_rls.projects VALUES ($1,$2,$3,'forged')",
						[randomUUID(), b, mb],
					),
				),
			).rejects.toMatchObject({ code: "42501" });
			await expect(
				scope(a, (c) =>
					c.query(
						"UPDATE phase0_rls.projects SET organization_id=$1 WHERE id=$2",
						[b, pa],
					),
				),
			).rejects.toMatchObject({ code: "42501" });
			await expect(
				scope(a, (c) =>
					c.query(
						"INSERT INTO phase0_rls.projects VALUES ($1,$2,$3,'bad-owner')",
						[randomUUID(), a, mb],
					),
				),
			).rejects.toMatchObject({ code: "23503" });
			await expect(
				scope(a, (c) =>
					c.query("INSERT INTO phase0_rls.tasks VALUES ($1,$2,$3)", [
						randomUUID(),
						a,
						pb,
					]),
				),
			).rejects.toMatchObject({ code: "23503" });
			expect(
				(
					await scope(a, (c) =>
						c.query("DELETE FROM phase0_rls.projects WHERE id=$1", [pb]),
					)
				).rowCount,
			).toBe(0);
		});
		it("denies DDL, TRUNCATE and privileged role escalation", async () => {
			for (const sql of [
				"TRUNCATE phase0_rls.projects CASCADE",
				"ALTER TABLE phase0_rls.projects DISABLE ROW LEVEL SECURITY",
				"SET ROLE postgres",
			]) {
				await expect(runtime.query(sql)).rejects.toMatchObject({
					code: "42501",
				});
			}
		});
		it("enforces both membership indexes while allowing the same user in another tenant", async () => {
			await expect(
				scope(a, (c) =>
					c.query(
						"INSERT INTO phase0_rls.memberships VALUES ($1,$2,$3,'inactive')",
						[randomUUID(), a, user],
					),
				),
			).rejects.toMatchObject({ code: "23505" });
			// Exercise each index through real restricted-role query plans, not metadata alone.
			for (const [org, status] of [
				[a, "active"],
				[b, "active"],
			]) {
				const rows = await scope(org, async (c) => {
					await c.query("SET LOCAL enable_seqscan=off");
					return (
						await c.query(
							"EXPLAIN (FORMAT JSON) SELECT id FROM phase0_rls.memberships WHERE user_id=$1 AND status=$2",
							[user, status],
						)
					).rows;
				});
				expect(JSON.stringify(rows)).toContain("memberships_user_status");
			}
			const rows = await scope(a, async (c) => {
				await c.query("SET LOCAL enable_seqscan=off");
				return (
					await c.query(
						"EXPLAIN (FORMAT JSON) SELECT id FROM phase0_rls.memberships WHERE organization_id=$1 AND user_id=$2",
						[a, user],
					)
				).rows;
			});
			expect(JSON.stringify(rows)).toContain(
				"memberships_organization_id_user_id_key",
			);
		});
		it("discards a terminated connection and isolates the next borrower", async () => {
			await expect(
				scope(a, async (client) => {
					const {
						rows: [{ pid }],
					} = await client.query("SELECT pg_backend_pid() AS pid");
					const pending = client.query("SELECT pg_sleep(2)");
					const observed = pending.catch((error) => error);
					await admin.query("SELECT pg_terminate_backend($1)", [pid]);
					throw await observed;
				}),
			).rejects.toMatchObject({ code: "57P01" });
			expect(
				(
					await scope(b, (client) =>
						client.query("SELECT name FROM phase0_rls.projects"),
					)
				).rows,
			).toEqual([{ name: "B" }]);
		});

		it("repeated concurrent pool borrowers never inherit another tenant", async () => {
			await Promise.all(
				Array.from({ length: 40 }, async (_, i) => {
					const org = i % 2 === 0 ? a : b;
					const { rows } = await scope(org, (c) =>
						c.query("SELECT organization_id FROM phase0_rls.projects"),
					);
					expect(rows).toEqual([{ organization_id: org }]);
				}),
			);
		});
	},
);

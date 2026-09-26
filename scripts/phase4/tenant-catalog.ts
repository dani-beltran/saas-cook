import { randomUUID } from "node:crypto";
import type { Pool } from "pg";

const quote = (name: string) => `"${name.replaceAll('"', '""')}"`;
type Table = {
	oid: number;
	schema: string;
	name: string;
	tenant_column: string | null;
	relrowsecurity: boolean;
	relforcerowsecurity: boolean;
};

/**
 * Discover every tenant table rather than maintaining an opt-in table list.
 * Evaluate its real pg_policy expressions with synthetic rows under the actual
 * restricted roles. A policy-only clone avoids manufacturing invalid business
 * rows or disabling the application's constraints; domain suites test those.
 */
export async function checkTenantCatalog(admin: Pool): Promise<string[]> {
	const failures: string[] = [];
	const client = await admin.connect();
	const probeSchema = `phase4_probe_${randomUUID().replaceAll("-", "")}`;
	const tenantA = randomUUID(),
		tenantB = randomUUID();
	try {
		await client.query("BEGIN");
		const tables = (
			await client.query<Table>(`
			SELECT c.oid,n.nspname AS schema,c.relname AS name,c.relrowsecurity,c.relforcerowsecurity,
			 CASE WHEN n.nspname='tenancy' AND c.relname='organizations' THEN 'id'
			 WHEN EXISTS(SELECT 1 FROM pg_attribute a WHERE a.attrelid=c.oid AND a.attname='organization_id' AND NOT a.attisdropped) THEN 'organization_id' END AS tenant_column
			FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
			WHERE c.relkind IN ('r','p') AND n.nspname NOT IN ('pg_catalog','information_schema')
			 AND (n.nspname='tenancy' OR EXISTS(SELECT 1 FROM pg_attribute a WHERE a.attrelid=c.oid AND a.attname='organization_id' AND NOT a.attisdropped))
			ORDER BY n.nspname,c.relname
		`)
		).rows;
		if (!tables.length)
			failures.push("No tenant tables found in the migrated database");
		await client.query(`CREATE SCHEMA ${quote(probeSchema)}`);
		await client.query(
			`GRANT USAGE ON SCHEMA ${quote(probeSchema)} TO common_saas_web,common_saas_worker`,
		);
		for (const table of tables) {
			const label = `${table.schema}.${table.name}`;
			const original = `${quote(table.schema)}.${quote(table.name)}`;
			if (!table.tenant_column) {
				failures.push(`${label}: tenant table lacks organization_id`);
				continue;
			}
			if (!table.relrowsecurity || !table.relforcerowsecurity)
				failures.push(`${label}: ENABLE and FORCE ROW LEVEL SECURITY required`);
			const invalidRelations = await client.query<{ conname: string }>(
				`
				SELECT con.conname FROM pg_constraint con
				JOIN pg_attribute target_tenant ON target_tenant.attrelid=con.confrelid AND target_tenant.attname='organization_id' AND NOT target_tenant.attisdropped
				WHERE con.contype='f' AND con.conrelid=$1 AND NOT EXISTS (
				 SELECT 1 FROM unnest(con.conkey,con.confkey) AS pair(source_key,target_key)
				 JOIN pg_attribute source_tenant ON source_tenant.attrelid=con.conrelid AND source_tenant.attnum=pair.source_key
				 WHERE source_tenant.attname='organization_id' AND pair.target_key=target_tenant.attnum)
			`,
				[table.oid],
			);
			for (const relation of invalidRelations.rows)
				failures.push(
					`${label}.${relation.conname}: relation must constrain both tenant identifiers`,
				);
			const policies = (
				await client.query<{
					polname: string;
					polcmd: string;
					polpermissive: boolean;
					roles: string[];
					using_expression: string | null;
					check_expression: string | null;
				}>(
					`SELECT p.polname,p.polcmd,p.polpermissive,
			 ARRAY(SELECT CASE WHEN role=0 THEN 'PUBLIC' ELSE pg_get_userbyid(role)::text END FROM unnest(p.polroles) role) AS roles,
			 pg_get_expr(p.polqual,p.polrelid) AS using_expression,pg_get_expr(p.polwithcheck,p.polrelid) AS check_expression
			 FROM pg_policy p WHERE p.polrelid=$1`,
					[table.oid],
				)
			).rows;
			const probe = `${quote(probeSchema)}.${quote(`table_${table.oid}`)}`;
			const column = quote(table.tenant_column);
			await client.query(
				`CREATE TABLE ${probe} AS SELECT * FROM ${original} WITH NO DATA`,
			);
			await client.query(`INSERT INTO ${probe}(${column}) VALUES($1),($2)`, [
				tenantA,
				tenantB,
			]);
			await client.query(`ALTER TABLE ${probe} ENABLE ROW LEVEL SECURITY`);
			await client.query(`ALTER TABLE ${probe} FORCE ROW LEVEL SECURITY`);
			for (const policy of policies) {
				const command = (
					{
						"*": "ALL",
						r: "SELECT",
						a: "INSERT",
						w: "UPDATE",
						d: "DELETE",
					} as Record<string, string>
				)[policy.polcmd];
				await client.query(
					`CREATE POLICY ${quote(policy.polname)} ON ${probe} AS ${policy.polpermissive ? "PERMISSIVE" : "RESTRICTIVE"} FOR ${command} TO ${policy.roles.map((role) => (role === "PUBLIC" ? role : quote(role))).join(",")}${policy.using_expression ? ` USING (${policy.using_expression})` : ""}${policy.check_expression ? ` WITH CHECK (${policy.check_expression})` : ""}`,
				);
			}
			for (const role of ["common_saas_web", "common_saas_worker"]) {
				const privileges = (
					await client.query<{
						select: boolean;
						insert: boolean;
						update: boolean;
						delete: boolean;
						truncate: boolean;
					}>(
						"SELECT has_table_privilege($1,$2::oid,'SELECT') AS select,has_table_privilege($1,$2::oid,'INSERT') AS insert,has_table_privilege($1,$2::oid,'UPDATE') AS update,has_table_privilege($1,$2::oid,'DELETE') AS delete,has_table_privilege($1,$2::oid,'TRUNCATE') AS truncate",
						[role, table.oid],
					)
				).rows[0];
				if (privileges.truncate)
					failures.push(`${label}: ${role} can truncate tenant data`);
				const grants = Object.entries(privileges)
					.filter(([, allowed]) => allowed)
					.map(([operation]) => operation.toUpperCase());
				if (grants.length)
					await client.query(
						`GRANT ${grants.join(",")} ON ${probe} TO ${quote(role)}`,
					);
				await client.query(`SET LOCAL ROLE ${quote(role)}`);
				const flags = (
					await client.query<{
						rolsuper: boolean;
						rolbypassrls: boolean;
						rolcreaterole: boolean;
					}>(
						"SELECT rolsuper,rolbypassrls,rolcreaterole FROM pg_roles WHERE rolname=current_user",
					)
				).rows[0];
				if (flags.rolsuper || flags.rolbypassrls || flags.rolcreaterole)
					failures.push(`${role}: restricted role has elevated privileges`);
				await client.query("SELECT set_config('app.organization_id','',true)");
				if (privileges.select) {
					if ((await client.query(`SELECT * FROM ${original}`)).rowCount !== 0)
						failures.push(
							`${label}: ${role} reads real rows without tenant context`,
						);
					if ((await client.query(`SELECT * FROM ${probe}`)).rowCount !== 0)
						failures.push(
							`${label}: ${role} policy exposes rows without tenant context`,
						);
					await client.query(
						"SELECT set_config('app.organization_id',$1,true)",
						[tenantA],
					);
					const rows = (
						await client.query(`SELECT ${column} AS tenant FROM ${probe}`)
					).rows;
					if (rows.length !== 1 || rows[0]?.tenant !== tenantA)
						failures.push(
							`${label}: ${role} policy fails same-tenant read/cross-tenant denial`,
						);
				}
				await client.query("SELECT set_config('app.organization_id',$1,true)", [
					tenantA,
				]);
				async function denied(sql: string, values: unknown[], purpose: string) {
					await client.query("SAVEPOINT denied_probe");
					try {
						await client.query(sql, values);
						failures.push(`${label}: ${role} ${purpose}`);
					} catch (error) {
						if (
							!(
								typeof error === "object" &&
								error !== null &&
								"code" in error &&
								error.code === "42501"
							)
						)
							throw error;
					} finally {
						await client.query("ROLLBACK TO SAVEPOINT denied_probe");
					}
				}
				if (privileges.insert)
					await denied(
						`INSERT INTO ${probe}(${column}) VALUES($1)`,
						[tenantB],
						"can insert into another tenant",
					);
				if (privileges.update && privileges.select)
					await denied(
						`UPDATE ${probe} SET ${column}=$1 WHERE ${column}=$2`,
						[tenantB, tenantA],
						"can move a row into another tenant",
					);
				if (
					privileges.delete &&
					(
						await client.query(`DELETE FROM ${probe} WHERE ${column}=$1`, [
							tenantB,
						])
					).rowCount !== 0
				)
					failures.push(`${label}: ${role} can delete another tenant's row`);
				await client.query("RESET ROLE");
			}
		}
		return failures;
	} finally {
		await client.query("ROLLBACK");
		client.release();
	}
}

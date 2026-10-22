import { createHash, randomUUID } from "node:crypto";
import type { createOperatorIdentity } from "@saas-cook/auth/operator";
import { checkOperator, operatorPublication } from "@saas-cook/authz/platform";
import {
	type OrganizationDirectoryOutput,
	organizationDirectoryInput,
	organizationDirectoryOutput,
} from "@saas-cook/backoffice-contracts";
import type { backofficeConfig } from "@saas-cook/config/backoffice";
import type { Pool } from "pg";
import { directoryCursor } from "./directory-cursor";

type Grant = { id: string; organization_id: string; expires_at: Date };

/**
 * Builds a bounded live directory over independently assigned organization grants.
 * Pools must use BO query/control-reader roles; identity supplies a verified staff
 * session and holds its lifecycle fences. Each call audits before disclosure,
 * checks current FGA and keeps the earliest expiry through commit. Any validation,
 * cursor, dependency or authorization failure rejects without returning a page.
 */
export function createOrganizationDirectory(options: {
	config: ReturnType<typeof backofficeConfig>;
	identity: ReturnType<typeof createOperatorIdentity>;
	queryPool: Pool;
	controlPool: Pool;
}) {
	const { config, identity, queryPool, controlPool } = options;
	const codec = directoryCursor(config.BACKOFFICE_AUTH_SECRET);
	return async (request: Request, raw: unknown) => {
		const input = organizationDirectoryInput.parse(raw);
		let actorId: string | null = null;
		try {
			return await identity.withSession(request, async (session) => {
				actorId = session.userId;
				const c = await queryPool.connect();
				try {
					await c.query("BEGIN");
					await c.query("SELECT pg_advisory_xact_lock_shared(1849202603)");
					await c.query("SELECT pg_advisory_xact_lock_shared(1849202610)");
					await c.query("SELECT backoffice.assert_directory_compatibility()");
					const state = await operatorPublication(
						controlPool,
						c,
						config.INSTALLATION_ID,
					);
					if (session.epoch !== state.epoch) throw new Error("Denied");
					await c.query(
						"SELECT set_config('backoffice.directory','on',true), set_config('backoffice.operator_id',$1,true), set_config('backoffice.epoch',$2,true), set_config('backoffice.environment',$3,true)",
						[session.userId, state.epoch, config.BACKOFFICE_ENVIRONMENT],
					);
					const now = (await c.query("SELECT clock_timestamp() AS now")).rows[0]
						.now as Date;
					// Management issues at most 20 exact grants. Bound defensive scope loading
					// too; unsupported larger assignments fail closed instead of scanning globally.
					const grants = (
						await c.query<Grant>(
							`SELECT id,organization_id,expires_at FROM backoffice.grants
						 WHERE user_id=$1 AND epoch=$2 AND environment=$3
						 ORDER BY organization_id,id LIMIT 201`,
							[session.userId, state.epoch, config.BACKOFFICE_ENVIRONMENT],
						)
					).rows;
					if (grants.length > 200) throw new Error("Directory scope limit");
					const active = grants.filter((grant) => grant.expires_at > now);
					const binding = createHash("sha256")
						.update(
							JSON.stringify({
								operator: session.userId,
								session: session.id,
								installation: config.INSTALLATION_ID,
								environment: config.BACKOFFICE_ENVIRONMENT,
								state,
								grants: active,
								query: {
									organizationId: input.organizationId ?? null,
									lifecycle: input.lifecycle ?? null,
									pageSize: input.pageSize,
									caseReference: input.caseReference,
								},
							}),
						)
						.digest("hex");
					const cursor = input.cursor
						? codec.open(input.cursor, binding, now.getTime())
						: null;
					const deadline = Math.min(
						session.expiresAt.getTime(),
						now.getTime() + 2000,
						...active.map((grant) => grant.expires_at.getTime()),
					);
					await c.query("SELECT set_config('backoffice.expires_at',$1,true)", [
						new Date(deadline).toISOString(),
					]);
					const candidates = [
						...new Set(active.map((grant) => grant.organization_id)),
					].filter(
						(id) =>
							(!cursor || id > cursor.after) &&
							(!input.organizationId || id === input.organizationId),
					);
					const items: OrganizationDirectoryOutput["items"] = [];
					let scanned = 0;
					// Small pages also bound filtered scans; an empty page can have a continuation.
					const scanLimit = Math.min(200, input.pageSize * 4);
					for (const id of candidates) {
						if (scanned >= scanLimit || items.length >= input.pageSize) break;
						scanned++;
						if (Date.now() >= deadline) throw new Error("Directory deadline");
						await checkOperator(config.OPENFGA_API_URL, state, {
							operatorId: session.userId,
							organizationId: id,
							installationId: config.INSTALLATION_ID,
							environment: config.BACKOFFICE_ENVIRONMENT,
						});
						// Canonical UUID order gives every directory transaction the same lock order.
						const row = (
							await c.query(
								"SELECT * FROM backoffice.organization_metadata($1)",
								[id],
							)
						).rows[0];
						if (!row || (input.lifecycle && row.lifecycle !== input.lifecycle))
							continue;
						items.push({
							id: row.id,
							name: row.name,
							lifecycle: row.lifecycle,
							sourceTimestamp: row.source_timestamp.toISOString(),
						});
					}
					const auditReference = randomUUID();
					await c.query(
						"INSERT INTO backoffice.audit_events(id,actor_id,action,case_reference,outcome,epoch) VALUES($1,$2,'organization.directory',$3,'allowed',$4)",
						[auditReference, session.userId, input.caseReference, state.epoch],
					);
					// Record each actual disclosure target without copying names, filters or cursors.
					for (const item of items)
						await c.query(
							"INSERT INTO backoffice.audit_events(id,actor_id,action,target_id,case_reference,outcome,epoch) VALUES($1,$2,'organization.read',$3,$4,'allowed',$5)",
							[
								randomUUID(),
								session.userId,
								item.id,
								input.caseReference,
								state.epoch,
							],
						);
					const final = await operatorPublication(
						controlPool,
						c,
						config.INSTALLATION_ID,
					);
					if (JSON.stringify(final) !== JSON.stringify(state))
						throw new Error("Publication changed");
					const checkedAt = (await c.query("SELECT clock_timestamp() AS now"))
						.rows[0].now as Date;
					const after = candidates[scanned - 1];
					const result = organizationDirectoryOutput.parse({
						items,
						auditReference,
						freshness: { kind: "live", checkedAt: checkedAt.toISOString() },
						nextCursor:
							scanned < candidates.length && after
								? codec.seal({
										version: 1,
										binding,
										after,
										expiresAt: Math.min(
											cursor?.expiresAt ?? now.getTime() + 300_000,
											session.expiresAt.getTime(),
											...active.map((grant) => grant.expires_at.getTime()),
										),
									})
								: null,
					});
					await c.query("COMMIT");
					return result;
				} catch (error) {
					await c.query("ROLLBACK");
					throw error;
				} finally {
					c.release();
				}
			});
		} catch (cause) {
			await queryPool.query(
				"INSERT INTO backoffice.audit_events(id,actor_id,action,case_reference,outcome) VALUES($1,$2,'organization.directory',$3,'denied')",
				[randomUUID(), actorId, input.caseReference],
			);
			throw new Error("Directory unavailable", { cause });
		}
	};
}

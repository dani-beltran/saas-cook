import { randomUUID } from "node:crypto";
import { createOperatorIdentity } from "@saas-cook/auth/operator";
import { checkOperator, operatorPublication } from "@saas-cook/authz/platform";
import {
	organizationLookupInput,
	organizationLookupOutput,
} from "@saas-cook/backoffice-contracts";
import { backofficeConfig } from "@saas-cook/config/backoffice";
import { Pool } from "pg";

/** Composes only restricted BO pools. Call close during graceful shutdown; no customer identity/runtime is instantiated. */
export function createBackofficeRuntime(env: NodeJS.ProcessEnv = process.env) {
	const config = backofficeConfig(env);
	const pool = (url: string) =>
		new Pool({
			connectionString: url,
			max: 4,
			connectionTimeoutMillis: 2000,
			statement_timeout: 2000,
			lock_timeout: 250,
			idle_in_transaction_session_timeout: 5000,
		});
	const identityPool = pool(config.BACKOFFICE_IDENTITY_DATABASE_URL),
		queryPool = pool(config.BACKOFFICE_DATABASE_URL),
		controlPool = pool(config.CONTROL_DATABASE_URL);
	const identity = createOperatorIdentity({
		pool: identityPool,
		origin: config.BACKOFFICE_ORIGIN,
		secret: config.BACKOFFICE_AUTH_SECRET,
		ingressSecret: config.BACKOFFICE_INGRESS_SECRET,
		cidrs: config.BACKOFFICE_CIDRS.split(","),
		publication: (c) =>
			operatorPublication(controlPool, c, config.INSTALLATION_ID),
	});
	return {
		identity,
		/** Audits one exact-ID metadata disclosure before returning bytes; missing and unauthorized IDs share a denial. */
		async lookup(request: Request, raw: unknown) {
			const input = organizationLookupInput.parse(raw);
			let actorId: string | null = null;
			try {
				return await identity.withSession(request, async (session) => {
					actorId = session.userId;
					const c = await queryPool.connect();
					try {
						await c.query("BEGIN");
						await c.query("SELECT pg_advisory_xact_lock_shared(1849202603)");
						await c.query("SELECT pg_advisory_xact_lock_shared(1849202610)");
						const state = await operatorPublication(
							controlPool,
							c,
							config.INSTALLATION_ID,
						);
						if (session.epoch !== state.epoch) throw new Error("Denied");
						await c.query(
							"SELECT set_config('backoffice.organization_id',$1,true), set_config('backoffice.operator_id',$2,true), set_config('backoffice.epoch',$3,true), set_config('backoffice.environment',$4,true)",
							[
								input.organizationId,
								session.userId,
								state.epoch,
								config.BACKOFFICE_ENVIRONMENT,
							],
						);
						const grant = (
							await c.query(
								`SELECT expires_at FROM backoffice.grants WHERE user_id=$1 AND organization_id=$2 AND epoch=$3 AND environment=$4 AND expires_at>clock_timestamp() ORDER BY expires_at DESC LIMIT 1`,
								[
									session.userId,
									input.organizationId,
									state.epoch,
									config.BACKOFFICE_ENVIRONMENT,
								],
							)
						).rows[0];
						if (!grant) throw new Error("Denied");
						await c.query(
							"SELECT set_config('backoffice.expires_at',least($1::timestamptz,$2::timestamptz)::text,true)",
							[session.expiresAt, grant.expires_at],
						);
						// This acquires the existing organization fence before current source data is read.
						const row = (
							await c.query(
								"SELECT * FROM backoffice.organization_metadata($1)",
								[input.organizationId],
							)
						).rows[0];
						if (!row) throw new Error("Denied");
						await checkOperator(config.OPENFGA_API_URL, state, {
							operatorId: session.userId,
							organizationId: input.organizationId,
							installationId: config.INSTALLATION_ID,
							environment: config.BACKOFFICE_ENVIRONMENT,
						});
						const auditReference = randomUUID();
						const result = organizationLookupOutput.parse({
							id: row.id,
							name: row.name,
							lifecycle: row.lifecycle,
							seats: { occupied: row.occupied, capacity: row.capacity },
							sourceTimestamp: row.source_timestamp.toISOString(),
							auditReference,
						});
						await c.query(
							"INSERT INTO backoffice.audit_events(id,actor_id,action,target_id,case_reference,outcome,epoch) VALUES($1,$2,'organization.read',$3,$4,'allowed',$5)",
							[
								auditReference,
								session.userId,
								input.organizationId,
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
						await c.query("COMMIT");
						return result;
					} catch (e) {
						await c.query("ROLLBACK");
						throw e;
					} finally {
						c.release();
					}
				});
			} catch (cause) {
				// Separate transaction survives rollback; a failed audit never converts denial to success.
				await queryPool.query(
					"INSERT INTO backoffice.audit_events(id,actor_id,action,target_id,case_reference,outcome) VALUES($1,$2,'organization.read',$3,$4,'denied')",
					[randomUUID(), actorId, input.organizationId, input.caseReference],
				);
				throw new Error("Organization unavailable", { cause });
			}
		},
		/** Checks actual roles, schema and independent publication without returning customer data. */
		async ready() {
			for (const [p, role] of [
				[identityPool, "saas_cook_bo_identity"],
				[queryPool, "saas_cook_bo_query"],
				[controlPool, "saas_cook_control_reader"],
			] as const) {
				const r = (
					await p.query(
						"SELECT current_user,rolsuper,rolbypassrls FROM pg_roles WHERE rolname=current_user",
					)
				).rows[0];
				if (r.current_user !== role || r.rolsuper || r.rolbypassrls)
					throw new Error("Restricted runtime role required");
			}
			const c = await queryPool.connect();
			try {
				const publication = await operatorPublication(
					controlPool,
					c,
					config.INSTALLATION_ID,
				);
				await checkOperator(config.OPENFGA_API_URL, publication, {
					operatorId: "readiness",
					organizationId: "readiness",
					installationId: config.INSTALLATION_ID,
					environment: config.BACKOFFICE_ENVIRONMENT,
				});
				await c.query("SELECT id FROM backoffice.grants LIMIT 0");
			} finally {
				c.release();
			}
		},
		/** Releases all pools after admission has stopped. */
		async close() {
			await Promise.all([
				identityPool.end(),
				queryPool.end(),
				controlPool.end(),
			]);
		},
	};
}

import type { Pool, PoolClient } from "pg";
import { modelHash, safeIdentifier } from "./model";

export interface Publication {
	installationId: string;
	bindingId: string;
	epoch: string;
	storeId: string;
	modelId: string;
	modelHash: string;
}
export async function initializeControlStore(pool: Pool): Promise<void> {
	const client = await pool.connect();
	try {
		const role = await client.query("SELECT current_user");
		if (role.rows[0].current_user !== "saas_cook_control_admin")
			throw new Error("Dedicated control administrator required");
		await client.query("BEGIN");
		await client.query("SELECT pg_advisory_xact_lock(1849202602)");
		await client.query(`CREATE SCHEMA IF NOT EXISTS control;
      REVOKE ALL ON SCHEMA control FROM PUBLIC;
      CREATE TABLE IF NOT EXISTS control.installations (
        installation_id uuid PRIMARY KEY, binding_id uuid NOT NULL, epoch uuid NOT NULL,
        state text NOT NULL CHECK (state IN ('initializing','ready','recovery_required')),
        store_id text, model_id text, model_hash text NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now(), ready_at timestamptz,
        CHECK (state <> 'ready' OR (store_id IS NOT NULL AND model_id IS NOT NULL AND ready_at IS NOT NULL))
      );
      CREATE TABLE IF NOT EXISTS control.security_events (
        id uuid PRIMARY KEY, installation_id uuid NOT NULL REFERENCES control.installations,
        epoch uuid NOT NULL, action text NOT NULL, evidence_reference text NOT NULL,
        occurred_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE TABLE IF NOT EXISTS control.operator_approvals (
        nonce uuid PRIMARY KEY, installation_id uuid NOT NULL REFERENCES control.installations,
        epoch uuid NOT NULL, payload_hash text NOT NULL, claims jsonb NOT NULL,
        state text NOT NULL CHECK (state IN ('pending','completed')),
        result jsonb, created_at timestamptz NOT NULL DEFAULT now(), completed_at timestamptz
      );
      CREATE TABLE IF NOT EXISTS control.model_upgrades (
        installation_id uuid NOT NULL REFERENCES control.installations,
        epoch uuid NOT NULL, from_model_id text NOT NULL, from_model_hash text NOT NULL,
        to_model_id text NOT NULL, to_model_hash text NOT NULL,
        completed_at timestamptz,
        PRIMARY KEY (installation_id,to_model_hash)
      );
      -- The predecessor allowed only one upgrade per installation. Preserve its
      -- receipt while allowing a subsequent independently recorded publication.
      DO $migration$ BEGIN
        IF EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='control.model_upgrades'::regclass AND contype='p' AND cardinality(conkey)=1) THEN
          ALTER TABLE control.model_upgrades DROP CONSTRAINT model_upgrades_pkey;
          ALTER TABLE control.model_upgrades ADD PRIMARY KEY (installation_id,to_model_hash);
        END IF;
      END $migration$;
      GRANT USAGE ON SCHEMA control TO saas_cook_control_reader;
      GRANT SELECT ON control.installations TO saas_cook_control_reader;`);
		await client.query("COMMIT");
	} catch (error) {
		await client.query("ROLLBACK").catch(() => {});
		throw error;
	} finally {
		client.release();
	}
}
export async function getPublication(
	controlPool: Pool | PoolClient,
	installationId: string,
): Promise<Publication> {
	safeIdentifier(installationId);
	const result = await controlPool.query(
		`SELECT installation_id AS "installationId", binding_id AS "bindingId", epoch,
    store_id AS "storeId", model_id AS "modelId", model_hash AS "modelHash"
    FROM control.installations WHERE installation_id=$1 AND state='ready'`,
		[installationId],
	);
	const state = result.rows[0] as Publication | undefined;
	if (
		!state ||
		state.modelHash !== modelHash ||
		!state.modelId ||
		!state.storeId
	)
		throw new Error("Independent authorization readiness required");
	return state;
}
export async function assertBinding(
	client: PoolClient,
	publication: Publication,
): Promise<void> {
	const binding = await client.query(
		`SELECT 1 FROM foundation.installation
    WHERE installation_id=$1 AND binding_id=$2 AND recovery_epoch=$3`,
		[publication.installationId, publication.bindingId, publication.epoch],
	);
	if (binding.rowCount !== 1)
		throw new Error("Application database requires recovery revalidation");
}

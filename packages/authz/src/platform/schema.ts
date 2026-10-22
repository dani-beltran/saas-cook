import type { PoolClient } from "pg";
/** Adds the independent operator publication under the existing control-admin transaction. */
export async function initializeOperatorPublication(c: PoolClient) {
	await c.query(`CREATE TABLE IF NOT EXISTS control.operator_publications (
 installation_id uuid PRIMARY KEY REFERENCES control.installations, epoch uuid NOT NULL,
 store_id text NOT NULL,model_id text NOT NULL,model_hash text NOT NULL);
 GRANT SELECT ON control.operator_publications TO saas_cook_control_reader;`);
}

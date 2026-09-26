import { randomUUID } from "node:crypto";
import type { Pool } from "pg";
import {
	assertBinding,
	getPublication,
	initializeControlStore,
} from "./control";
import { fgaRequest, publishModel, validateModel } from "./fga";
import { modelHash, safeIdentifier } from "./model";

type CommandOptions = {
	applicationPool: Pool;
	controlPool: Pool;
	installationId: string;
	openfgaUrl: string;
};
/** Initial initialization only. Independent pending receipts allow bounded, safe retries. */
export async function bootstrap(options: CommandOptions): Promise<void> {
	safeIdentifier(options.installationId);
	await initializeControlStore(options.controlPool);
	const control = await options.controlPool.connect();
	const app = await options.applicationPool.connect();
	try {
		await control.query("SET lock_timeout='5s'");
		await app.query("SET lock_timeout='5s'");
		await control.query("SELECT pg_advisory_lock(hashtextextended($1,0))", [
			`installation:${options.installationId}`,
		]);
		await app.query("SELECT pg_advisory_lock(1849202603)");
		const role = await app.query("SELECT current_user");
		if (role.rows[0].current_user !== "common_saas_migrator")
			throw new Error("Bootstrap requires dedicated application migrator");
		const found = await control.query(
			"SELECT * FROM control.installations WHERE installation_id=$1",
			[options.installationId],
		);
		let pending = found.rows[0];
		if (pending && pending.state !== "initializing")
			throw new Error(
				"Existing or restored installations cannot bootstrap as fresh",
			);
		const existing = await app.query(
			`SELECT EXISTS(SELECT 1 FROM identity."user") OR EXISTS(SELECT 1 FROM tenancy.organizations) AS populated`,
		);
		if (existing.rows[0].populated)
			throw new Error(
				"Existing or restored application data requires recovery; fresh bootstrap refused",
			);
		const marker = await app.query("SELECT * FROM foundation.installation");
		if (!pending) {
			if (marker.rowCount)
				throw new Error(
					"Existing or restored application binding cannot bootstrap as fresh",
				);
			pending = {
				installation_id: options.installationId,
				binding_id: randomUUID(),
				epoch: randomUUID(),
				model_hash: modelHash,
				store_id: null,
				model_id: null,
			};
			await control.query(
				`INSERT INTO control.installations (installation_id,binding_id,epoch,state,model_hash)
        VALUES ($1,$2,$3,'initializing',$4)`,
				[pending.installation_id, pending.binding_id, pending.epoch, modelHash],
			);
		}
		if (pending.model_hash !== modelHash)
			throw new Error(
				"Bootstrap compiler changed during pending initialization",
			);
		const local = marker.rows[0];
		if (
			local &&
			(local.installation_id !== pending.installation_id ||
				local.binding_id !== pending.binding_id ||
				local.recovery_epoch !== pending.epoch)
		)
			throw new Error(
				"Application binding differs from independent initialization receipt",
			);
		if (!local)
			await app.query(
				`INSERT INTO foundation.installation (installation_id,binding_id,recovery_epoch) VALUES ($1,$2,$3)`,
				[pending.installation_id, pending.binding_id, pending.epoch],
			);
		if (!pending.store_id) {
			const store = await fgaRequest<{ id: string }>(
				options.openfgaUrl,
				"/stores",
				{ name: `common-saas-${options.installationId}` },
			);
			if (!/^[A-Z0-9]{26}$/.test(store.id))
				throw new Error("Invalid authorization store receipt");
			pending.store_id = store.id;
			await control.query(
				"UPDATE control.installations SET store_id=$2 WHERE installation_id=$1",
				[options.installationId, store.id],
			);
		}
		if (!pending.model_id) {
			pending.model_id = await publishModel(
				options.openfgaUrl,
				pending.store_id,
			);
			await control.query(
				"UPDATE control.installations SET model_id=$2 WHERE installation_id=$1",
				[options.installationId, pending.model_id],
			);
		}
		await validateModel(options.openfgaUrl, pending.store_id, pending.model_id);
		await control.query("BEGIN");
		await control.query(
			"UPDATE control.installations SET state='ready',ready_at=clock_timestamp() WHERE installation_id=$1 AND state='initializing'",
			[options.installationId],
		);
		await control.query(
			`INSERT INTO control.security_events(id,installation_id,epoch,action,evidence_reference) VALUES($1,$2,$3,'bootstrap.completed',$4)`,
			[
				randomUUID(),
				options.installationId,
				pending.epoch,
				`model-sha256:${modelHash}`,
			],
		);
		await control.query("COMMIT");
	} catch (error) {
		await control.query("ROLLBACK").catch(() => {});
		throw error;
	} finally {
		await app.query("SELECT pg_advisory_unlock(1849202603)").catch(() => {});
		await control
			.query("SELECT pg_advisory_unlock(hashtextextended($1,0))", [
				`installation:${options.installationId}`,
			])
			.catch(() => {});
		app.release();
		control.release();
	}
}
/** Validate the immutable, already published compiler/model and source commits. Never clear recovery. */
export async function publishAuthorization(
	options: CommandOptions,
): Promise<void> {
	const publication = await getPublication(
		options.controlPool,
		options.installationId,
	);
	const client = await options.applicationPool.connect();
	try {
		const role = await client.query("SELECT current_user");
		if (role.rows[0].current_user !== "common_saas_migrator")
			throw new Error("Publication requires dedicated application migrator");
		await client.query("BEGIN");
		await assertBinding(client, publication);
		const invalid = await client.query(
			`SELECT 1 FROM tenancy.authorization_revisions
      WHERE desired_revision<>applied_revision OR NOT ready OR evaluation_mode<>'contextual-v1'
        OR recovery_epoch<>$1 OR store_id<>$2 OR model_id<>$3 OR model_hash<>$4 LIMIT 1`,
			[publication.epoch, publication.storeId, publication.modelId, modelHash],
		);
		if (invalid.rowCount)
			throw new Error("Source publication or recovery revalidation required");
		await validateModel(
			options.openfgaUrl,
			publication.storeId,
			publication.modelId,
		);
		await client.query("COMMIT");
	} catch (error) {
		await client.query("ROLLBACK").catch(() => {});
		throw error;
	} finally {
		client.release();
	}
}

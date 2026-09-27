import { randomUUID } from "node:crypto";
import type { Pool } from "pg";
import {
	assertBinding,
	getPublication,
	initializeControlStore,
} from "./control";
import { fgaRequest, publishModel, validateModel } from "./fga";
import { modelHash, predecessorModelHashes, safeIdentifier } from "./model";

type CommandOptions = {
	applicationPool: Pool;
	controlPool: Pool;
	installationId: string;
	openfgaUrl: string;
};
/** Initialize or resume safely; matching completed installations return without reinitializing. */
export async function bootstrap(
	options: CommandOptions,
): Promise<"completed" | "already-completed"> {
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
		if (role.rows[0].current_user !== "saas_cook_migrator")
			throw new Error("Bootstrap requires dedicated application migrator");
		const found = await control.query(
			"SELECT * FROM control.installations WHERE installation_id=$1",
			[options.installationId],
		);
		let pending = found.rows[0];
		if (pending?.state === "ready") {
			const publication = await getPublication(control, options.installationId);
			await assertBinding(app, publication);
			return "already-completed";
		}
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
				{ name: `saas-cook-${options.installationId}` },
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
		return "completed";
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
		if (role.rows[0].current_user !== "saas_cook_migrator")
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

/** Explicit compiler migration of a reviewed ready predecessor installation, never a recovery operation.
 * Quiesce older application versions before running; interrupted upgrades fail closed and resume.
 */
export async function upgradeAuthorization(
	options: CommandOptions,
): Promise<void> {
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
		if (
			(await app.query("SELECT current_user")).rows[0].current_user !==
			"saas_cook_migrator"
		)
			throw new Error("Model upgrade requires dedicated application migrator");
		const state = (
			await control.query(
				"SELECT * FROM control.installations WHERE installation_id=$1 AND state='ready'",
				[options.installationId],
			)
		).rows[0];
		if (
			!state ||
			![...predecessorModelHashes, modelHash].includes(state.model_hash)
		)
			throw new Error("Only the reviewed ready predecessor can upgrade");
		await assertBinding(app, {
			installationId: state.installation_id,
			bindingId: state.binding_id,
			epoch: state.epoch,
			storeId: state.store_id,
			modelId: state.model_id,
			modelHash: state.model_hash,
		});
		const interruptedPredecessor = await control.query(
			"SELECT 1 FROM control.model_upgrades WHERE installation_id=$1 AND to_model_hash<>$2 AND completed_at IS NULL",
			[options.installationId, modelHash],
		);
		if (interruptedPredecessor.rowCount)
			throw new Error(
				"Complete the interrupted predecessor model upgrade first",
			);
		let receipt = (
			await control.query(
				"SELECT * FROM control.model_upgrades WHERE installation_id=$1 AND to_model_hash=$2",
				[options.installationId, modelHash],
			)
		).rows[0];
		if (
			receipt &&
			(receipt.epoch !== state.epoch ||
				receipt.to_model_hash !== modelHash ||
				!predecessorModelHashes.includes(receipt.from_model_hash) ||
				![receipt.from_model_id, receipt.to_model_id].includes(state.model_id))
		)
			throw new Error(
				"Model upgrade receipt differs from independent publication",
			);
		if (state.model_hash === modelHash && (!receipt || receipt.completed_at)) {
			const invalid = await app.query(
				`SELECT 1 FROM tenancy.authorization_revisions WHERE NOT ready OR desired_revision<>applied_revision OR evaluation_mode<>'contextual-v1' OR recovery_epoch<>$1 OR store_id<>$2 OR model_id<>$3 OR model_hash<>$4 LIMIT 1`,
				[state.epoch, state.store_id, state.model_id, modelHash],
			);
			if (invalid.rowCount)
				throw new Error(
					"Source recovery revalidation required before model upgrade",
				);
			await validateModel(options.openfgaUrl, state.store_id, state.model_id);
			const current = await getPublication(control, options.installationId);
			if (
				current.epoch !== state.epoch ||
				current.modelId !== state.model_id ||
				current.storeId !== state.store_id ||
				current.bindingId !== state.binding_id
			)
				throw new Error(
					"Independent publication changed during model validation",
				);
			return;
		}
		if (!receipt) {
			const next = await publishModel(options.openfgaUrl, state.store_id);
			await validateModel(options.openfgaUrl, state.store_id, next);
			receipt = (
				await control.query(
					"INSERT INTO control.model_upgrades(installation_id,epoch,from_model_id,from_model_hash,to_model_id,to_model_hash) VALUES($1,$2,$3,$4,$5,$6) RETURNING *",
					[
						options.installationId,
						state.epoch,
						state.model_id,
						state.model_hash,
						next,
						modelHash,
					],
				)
			).rows[0];
		}
		await validateModel(
			options.openfgaUrl,
			state.store_id,
			receipt.to_model_id,
		);
		await app.query("BEGIN");
		const organizations = await app.query<{ organization_id: string }>(
			"SELECT organization_id FROM tenancy.authorization_revisions ORDER BY organization_id",
		);
		for (const row of organizations.rows)
			await app.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
				`organization:${row.organization_id}`,
			]);
		const invalid = await app.query(
			`SELECT 1 FROM tenancy.authorization_revisions WHERE NOT ready OR desired_revision<>applied_revision OR evaluation_mode<>'contextual-v1' OR recovery_epoch<>$1 OR store_id<>$2 OR NOT ((model_id=$3 AND model_hash=$4) OR (model_id=$5 AND model_hash=$6)) LIMIT 1`,
			[
				state.epoch,
				state.store_id,
				receipt.from_model_id,
				receipt.from_model_hash,
				receipt.to_model_id,
				modelHash,
			],
		);
		if (invalid.rowCount)
			throw new Error(
				"Source recovery revalidation required before model upgrade",
			);
		await app.query(
			"UPDATE tenancy.authorization_revisions SET model_id=$1,model_hash=$2,desired_revision=desired_revision+1,applied_revision=desired_revision+1,updated_at=clock_timestamp() WHERE model_id=$3 AND model_hash=$4",
			[
				receipt.to_model_id,
				modelHash,
				receipt.from_model_id,
				receipt.from_model_hash,
			],
		);
		await app.query("COMMIT");
		await control.query("BEGIN");
		const published = await control.query(
			"UPDATE control.installations SET model_id=$2,model_hash=$3 WHERE installation_id=$1 AND state='ready' AND epoch=$4 AND model_id=$5 AND model_hash=$6 AND binding_id=$7 RETURNING installation_id",
			[
				options.installationId,
				receipt.to_model_id,
				modelHash,
				state.epoch,
				state.model_id,
				state.model_hash,
				state.binding_id,
			],
		);
		if (published.rowCount !== 1)
			throw new Error("Independent publication changed during model upgrade");
		const completed = await control.query(
			"UPDATE control.model_upgrades SET completed_at=clock_timestamp() WHERE installation_id=$1 AND to_model_hash=$2 AND completed_at IS NULL RETURNING installation_id",
			[options.installationId, modelHash],
		);
		if (completed.rowCount)
			await control.query(
				"INSERT INTO control.security_events(id,installation_id,epoch,action,evidence_reference) VALUES($1,$2,$3,'authorization.model_upgraded',$4)",
				[
					randomUUID(),
					options.installationId,
					state.epoch,
					`model-sha256:${modelHash}`,
				],
			);
		await control.query("COMMIT");
	} catch (error) {
		await app.query("ROLLBACK").catch(() => {});
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

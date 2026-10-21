import { createHash, createPublicKey, randomUUID, verify } from "node:crypto";
import type { Pool } from "pg";
import { fgaRequest, publishModel, validateModel } from "./fga";
import { readDeletionJournal } from "./journal";
import { modelHash } from "./model";

export interface RecoveryApproval {
	version: 1;
	installationId: string;
	epoch: string;
	nonce: string;
	operatorId: string;
	mfaAt: string;
	expiresAt: string;
	evidenceReference: string;
	source:
		| "independent-identity"
		| "current-directory"
		| "independent-system-attestation";
	action: "begin" | "replay" | "release" | "enroll";
	mode: "application" | "fga-only";
	isolationEvidence: string;
	applicationHash: string;
	enrollment?: { userId: string; verifiedEmail: string };
}
const hash = (s: string) => createHash("sha256").update(s).digest("hex");
/** Recovery never accepts an unsigned boolean or evidence obtained only from a restored snapshot. */
export function verifyRecoveryApproval(
	text: string,
	key: string,
	now = Date.now(),
) {
	const fail = () => {
		throw new Error("Invalid independent recovery approval");
	};
	if (Buffer.byteLength(text) > 16384) fail();
	const e = JSON.parse(text) as { payload: string; signature: string };
	if (
		!e ||
		Object.keys(e).some((k) => !["payload", "signature"].includes(k)) ||
		typeof e.payload !== "string" ||
		typeof e.signature !== "string" ||
		!/^[A-Za-z0-9_-]+$/.test(e.payload) ||
		!/^[A-Za-z0-9_-]+$/.test(e.signature)
	)
		return fail();
	const bytes = Buffer.from(e.payload, "base64url"),
		publicKey = createPublicKey(key);
	if (
		publicKey.asymmetricKeyType !== "ed25519" ||
		!verify(null, bytes, publicKey, Buffer.from(e.signature, "base64url"))
	)
		fail();
	const c = JSON.parse(bytes.toString("utf8")) as RecoveryApproval;
	if (
		c?.version !== 1 ||
		Object.keys(c).some(
			(k) =>
				![
					"version",
					"installationId",
					"epoch",
					"nonce",
					"operatorId",
					"mfaAt",
					"expiresAt",
					"evidenceReference",
					"source",
					"action",
					"mode",
					"isolationEvidence",
					"applicationHash",
					"enrollment",
				].includes(k),
		) ||
		![c.installationId, c.epoch, c.nonce].every(
			(v) => typeof v === "string" && /^[a-f0-9-]{36}$/.test(v),
		) ||
		![c.operatorId, c.evidenceReference, c.isolationEvidence].every(
			(v) => typeof v === "string" && /^[\x21-\x7e]{8,240}$/.test(v),
		) ||
		![
			"independent-identity",
			"current-directory",
			"independent-system-attestation",
		].includes(c.source) ||
		!["begin", "replay", "release", "enroll"].includes(c.action) ||
		!["application", "fga-only"].includes(c.mode) ||
		!/^[a-f0-9]{64}$/.test(c.applicationHash)
	)
		fail();
	const mfa = Date.parse(c.mfaAt),
		expiry = Date.parse(c.expiresAt);
	if (
		!Number.isFinite(mfa) ||
		!Number.isFinite(expiry) ||
		mfa > now ||
		now - mfa > 300000 ||
		expiry <= now ||
		expiry > mfa + 300000
	)
		fail();
	if (c.mode === "fga-only" && c.source !== "independent-system-attestation")
		fail();
	if (c.action === "enroll") {
		if (
			c.mode !== "application" ||
			c.source === "independent-system-attestation" ||
			!c.enrollment ||
			Object.keys(c.enrollment).some(
				(k) => !["userId", "verifiedEmail"].includes(k),
			) ||
			!/^[a-zA-Z0-9_-]{1,128}$/.test(c.enrollment.userId) ||
			!/^[^\s@]{1,100}@[^\s@]{1,100}\.[^\s@]{1,30}$/.test(
				c.enrollment.verifiedEmail,
			)
		)
			fail();
	} else if (c.enrollment !== undefined) fail();
	return { claims: c, payloadHash: hash(bytes.toString("utf8")) };
}
export interface RecoveryApplication {
	/** Hashes current security, identity and policy state; independently signed intact-store evidence must match it. */
	fingerprint(): Promise<string>;
	/** Runs with the dedicated recovery role and drains the global application fence. */
	reset(
		mode: "application" | "fga-only",
		epoch: string,
		expectedFingerprint: string,
	): Promise<void>;
	replay(
		journal: Awaited<ReturnType<typeof readDeletionJournal>>,
	): Promise<void>;
	enroll(userId: string, verifiedEmail: string, epoch: string): Promise<void>;
	publish(input: {
		epoch: string;
		storeId: string;
		modelId: string;
		modelHash: string;
	}): Promise<void>;
	verify(epoch: string): Promise<void>;
}
export async function initializeRecovery(c: import("pg").PoolClient) {
	await c.query(`CREATE TABLE IF NOT EXISTS control.recovery_runs(
 installation_id uuid NOT NULL REFERENCES control.installations,epoch uuid NOT NULL,mode text NOT NULL,
 phase text NOT NULL,application_hash text NOT NULL,journal_sequence bigint,journal_hash text,
 store_id text,model_id text,created_at timestamptz NOT NULL DEFAULT clock_timestamp(),released_at timestamptz,
 PRIMARY KEY(installation_id,epoch));
 GRANT SELECT ON control.recovery_runs TO saas_cook_control_reader;`);
}
/** One signed command per step. All failure paths leave independent readiness closed. */
export async function runRecovery(options: {
	control: Pool;
	application: RecoveryApplication;
	installationId: string;
	openfgaUrl: string;
	publicKey: string;
	envelope: string;
}) {
	const { claims, payloadHash } = verifyRecoveryApproval(
		options.envelope,
		options.publicKey,
	);
	if (claims.installationId !== options.installationId)
		throw new Error("Recovery installation mismatch");
	const c = await options.control.connect();
	try {
		if (
			(await c.query("SELECT current_user")).rows[0].current_user !==
			"saas_cook_control_admin"
		)
			throw new Error("Dedicated recovery control authority required");
		await c.query("SET lock_timeout='5s'");
		await c.query("SELECT pg_advisory_lock(hashtextextended($1,0))", [
			`installation:${options.installationId}`,
		]);
		const prior = (
			await c.query("SELECT * FROM control.operator_approvals WHERE nonce=$1", [
				claims.nonce,
			])
		).rows[0];
		if (prior && prior.payload_hash !== payloadHash)
			throw new Error("Recovery nonce reused");
		if (prior?.state === "completed") return prior.result;
		const state = (
			await c.query(
				"SELECT * FROM control.installations WHERE installation_id=$1",
				[options.installationId],
			)
		).rows[0];
		if (!state || state.epoch !== claims.epoch)
			throw new Error("Recovery epoch mismatch");
		await c.query(
			"INSERT INTO control.operator_approvals(nonce,installation_id,epoch,payload_hash,claims,state) VALUES($1,$2,$3,$4,$5,'pending') ON CONFLICT DO NOTHING",
			[
				claims.nonce,
				claims.installationId,
				claims.epoch,
				payloadHash,
				JSON.stringify(claims),
			],
		);
		let result: { epoch: string; phase: string };
		if (claims.action === "begin") {
			if (state.state !== "ready")
				throw new Error("Resume the active recovery run");
			if (
				claims.mode === "fga-only" &&
				(await options.application.fingerprint()) !== claims.applicationHash
			)
				throw new Error("Intact application attestation mismatch");
			const epoch = randomUUID();
			await c.query("BEGIN");
			await c.query(
				"UPDATE control.installations SET epoch=$2,state='recovery_required',ready_at=NULL WHERE installation_id=$1",
				[claims.installationId, epoch],
			);
			await c.query(
				"INSERT INTO control.recovery_runs(installation_id,epoch,mode,phase,application_hash) VALUES($1,$2,$3,'closed',$4)",
				[claims.installationId, epoch, claims.mode, claims.applicationHash],
			);
			result = { epoch, phase: "closed" };
			await c.query(
				"INSERT INTO control.security_events(id,installation_id,epoch,action,evidence_reference) VALUES($1,$2,$3,'recovery.begin',$4)",
				[randomUUID(), claims.installationId, epoch, claims.evidenceReference],
			);
			await c.query(
				"UPDATE control.operator_approvals SET state='completed',result=$2,completed_at=clock_timestamp() WHERE nonce=$1",
				[claims.nonce, JSON.stringify(result)],
			);
			await c.query("COMMIT");
			return result;
		}
		const run = (
			await c.query(
				"SELECT * FROM control.recovery_runs WHERE installation_id=$1 AND epoch=$2",
				[claims.installationId, claims.epoch],
			)
		).rows[0];
		if (!run || run.mode !== claims.mode || state.state !== "recovery_required")
			throw new Error("Closed recovery run required");
		if (claims.action === "enroll") {
			if (run.phase !== "replayed" || !claims.enrollment)
				throw new Error("Replay before identity re-enrollment");
			await options.application.enroll(
				claims.enrollment.userId,
				claims.enrollment.verifiedEmail,
				claims.epoch,
			);
			result = { epoch: claims.epoch, phase: run.phase };
		} else {
			if (claims.action === "replay" && run.phase === "closed") {
				await options.application.reset(
					run.mode,
					claims.epoch,
					run.application_hash,
				);
				await c.query(
					"UPDATE control.recovery_runs SET phase='reset' WHERE installation_id=$1 AND epoch=$2",
					[claims.installationId, claims.epoch],
				);
			}
			// Drain application work before acquiring the journal barrier: capture registers app -> journal.
			// The journal writer uses this same barrier. Release cannot miss an acknowledged deletion.
			await c.query("SELECT pg_advisory_lock(hashtextextended($1,0))", [
				`journal:${claims.installationId}`,
			]);
			try {
				const journal = await readDeletionJournal(c, claims.installationId);
				if (claims.action === "replay") {
					await options.application.replay(journal);
					let storeId = run.store_id,
						modelId = run.model_id;
					if (!storeId) {
						storeId = (
							await fgaRequest<{ id: string }>(options.openfgaUrl, "/stores", {
								name: `recovery-${claims.epoch}`,
							})
						).id;
						await c.query(
							"UPDATE control.recovery_runs SET store_id=$3 WHERE installation_id=$1 AND epoch=$2",
							[claims.installationId, claims.epoch, storeId],
						);
					}
					if (!modelId) {
						modelId = await publishModel(options.openfgaUrl, storeId);
						await c.query(
							"UPDATE control.recovery_runs SET model_id=$3 WHERE installation_id=$1 AND epoch=$2",
							[claims.installationId, claims.epoch, modelId],
						);
					}
					await validateModel(options.openfgaUrl, storeId, modelId);
					await options.application.publish({
						epoch: claims.epoch,
						storeId,
						modelId,
						modelHash,
					});
					await c.query(
						"UPDATE control.recovery_runs SET phase='replayed',journal_sequence=$3,journal_hash=$4 WHERE installation_id=$1 AND epoch=$2",
						[
							claims.installationId,
							claims.epoch,
							journal.sequence,
							journal.hash,
						],
					);
					result = { epoch: claims.epoch, phase: "replayed" };
				} else {
					if (
						run.phase !== "replayed" ||
						Number(run.journal_sequence) !== journal.sequence ||
						run.journal_hash !== journal.hash
					)
						throw new Error("Catch up the complete journal before release");
					await options.application.verify(claims.epoch);
					await validateModel(options.openfgaUrl, run.store_id, run.model_id);
					await c.query("BEGIN");
					await c.query(
						"UPDATE control.installations SET state='ready',store_id=$3,model_id=$4,model_hash=$5,ready_at=clock_timestamp() WHERE installation_id=$1 AND epoch=$2 AND state='recovery_required'",
						[
							claims.installationId,
							claims.epoch,
							run.store_id,
							run.model_id,
							modelHash,
						],
					);
					await c.query(
						"UPDATE control.recovery_runs SET phase='released',released_at=clock_timestamp() WHERE installation_id=$1 AND epoch=$2",
						[claims.installationId, claims.epoch],
					);
					result = { epoch: claims.epoch, phase: "released" };
					await c.query(
						"INSERT INTO control.security_events(id,installation_id,epoch,action,evidence_reference) VALUES($1,$2,$3,'recovery.release',$4)",
						[
							randomUUID(),
							claims.installationId,
							claims.epoch,
							claims.evidenceReference,
						],
					);
					await c.query(
						"UPDATE control.operator_approvals SET state='completed',result=$2,completed_at=clock_timestamp() WHERE nonce=$1",
						[claims.nonce, JSON.stringify(result)],
					);
					await c.query("COMMIT");
					return result;
				}
			} finally {
				await c.query("SELECT pg_advisory_unlock(hashtextextended($1,0))", [
					`journal:${claims.installationId}`,
				]);
			}
		}
		await c.query(
			"INSERT INTO control.security_events(id,installation_id,epoch,action,evidence_reference) VALUES($1,$2,$3,$4,$5)",
			[
				randomUUID(),
				claims.installationId,
				claims.epoch,
				`recovery.${claims.action}`,
				claims.evidenceReference,
			],
		);
		await c.query(
			"UPDATE control.operator_approvals SET state='completed',result=$2,completed_at=clock_timestamp() WHERE nonce=$1",
			[claims.nonce, JSON.stringify(result)],
		);
		return result;
	} catch (e) {
		await c.query("ROLLBACK").catch(() => {});
		throw e;
	} finally {
		await c
			.query("SELECT pg_advisory_unlock(hashtextextended($1,0))", [
				`installation:${options.installationId}`,
			])
			.catch(() => {});
		c.release();
	}
}

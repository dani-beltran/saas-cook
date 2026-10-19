import { createHash } from "node:crypto";
import type { Pool, PoolClient } from "pg";

export type JournalSubject = "account" | "organization";
export interface DeletionRecord {
	version: 1;
	requestId: string;
	subjectKind: JournalSubject;
	subjectId: string;
	action: "scheduled" | "canceled" | "progress" | "completed";
	effectiveAt: string;
	retained: readonly string[];
	statusHash?: string;
	organizations: readonly string[];
	resolutions?: readonly {
		organizationId: string;
		successorUserId: string;
		transferId: string | null;
	}[];
	steps: readonly string[];
}
export interface JournalEntry {
	sequence: number;
	previous: string;
	hash: string;
	payload: string;
}
const zero = "0".repeat(64);
const hash = (value: string) =>
	createHash("sha256").update(value).digest("hex");

/** Called only by the independent control administrator during schema setup. */
export async function initializeJournal(c: PoolClient) {
	await c.query(`
 CREATE TABLE IF NOT EXISTS control.journal_heads (
 installation_id uuid PRIMARY KEY REFERENCES control.installations,
 sequence bigint NOT NULL DEFAULT 0, hash text NOT NULL DEFAULT repeat('0',64));
 CREATE TABLE IF NOT EXISTS control.deletion_journal (
 installation_id uuid NOT NULL REFERENCES control.installations,
 sequence bigint NOT NULL, event_key text NOT NULL, previous text NOT NULL,
 hash text NOT NULL, payload text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(installation_id,sequence), UNIQUE(installation_id,event_key));
 INSERT INTO control.journal_heads(installation_id) SELECT installation_id FROM control.installations i WHERE NOT EXISTS (SELECT 1 FROM control.deletion_journal j WHERE j.installation_id=i.installation_id) ON CONFLICT DO NOTHING;
 CREATE TABLE IF NOT EXISTS control.analytics_subjects(installation_id uuid NOT NULL REFERENCES control.installations,id text NOT NULL,user_id text NOT NULL,organization_id uuid,PRIMARY KEY(installation_id,id));
 CREATE TABLE IF NOT EXISTS control.analytics_attempts(installation_id uuid NOT NULL,id uuid NOT NULL,subject_id text NOT NULL,settled boolean NOT NULL DEFAULT false,PRIMARY KEY(installation_id,id),FOREIGN KEY(installation_id,subject_id) REFERENCES control.analytics_subjects(installation_id,id));
 CREATE OR REPLACE FUNCTION control.register_analytics(p_install uuid,p_id text,p_user text,p_org uuid) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,control AS $body$
 BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended('journal:'||p_install::text,0));
 IF p_id !~ '^[a-f0-9]{64}$' OR length(p_user)>128 THEN RAISE EXCEPTION 'Invalid analytics identity'; END IF;
 IF EXISTS(SELECT 1 FROM control.deletion_journal j WHERE installation_id=p_install AND payload::jsonb->>'action'='scheduled' AND ((payload::jsonb->>'subjectKind'='account' AND payload::jsonb->>'subjectId'=p_user) OR (payload::jsonb->>'subjectKind'='organization' AND payload::jsonb->>'subjectId'=p_org::text))) THEN RAISE EXCEPTION 'Analytics subject suppressed'; END IF;
 INSERT INTO control.analytics_subjects VALUES(p_install,p_id,p_user,p_org) ON CONFLICT DO NOTHING;
 IF NOT EXISTS(SELECT 1 FROM control.analytics_subjects WHERE installation_id=p_install AND id=p_id AND user_id=p_user AND organization_id IS NOT DISTINCT FROM p_org) THEN RAISE EXCEPTION 'Analytics identity conflict'; END IF;
 END $body$;
 REVOKE ALL ON FUNCTION control.register_analytics(uuid,text,text,uuid) FROM PUBLIC;
 GRANT EXECUTE ON FUNCTION control.register_analytics(uuid,text,text,uuid) TO saas_cook_journal_writer;
 GRANT SELECT ON control.analytics_subjects TO saas_cook_control_reader;
 CREATE OR REPLACE FUNCTION control.begin_analytics(p_install uuid,p_id text,p_user text,p_org uuid,p_event uuid) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,control AS $body$
 BEGIN
 PERFORM control.register_analytics(p_install,p_id,p_user,p_org);
 INSERT INTO control.analytics_attempts(installation_id,id,subject_id) VALUES(p_install,p_event,p_id) ON CONFLICT DO NOTHING;
 IF NOT EXISTS(SELECT 1 FROM control.analytics_attempts WHERE installation_id=p_install AND id=p_event AND subject_id=p_id) THEN RAISE EXCEPTION 'Analytics attempt conflict'; END IF;
 END $body$;
 CREATE OR REPLACE FUNCTION control.settle_analytics(p_install uuid,p_event uuid) RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog,control AS $body$
 UPDATE control.analytics_attempts SET settled=true WHERE installation_id=p_install AND id=p_event
 $body$;
 REVOKE ALL ON FUNCTION control.begin_analytics(uuid,text,text,uuid,uuid),control.settle_analytics(uuid,uuid) FROM PUBLIC;
 GRANT EXECUTE ON FUNCTION control.begin_analytics(uuid,text,text,uuid,uuid),control.settle_analytics(uuid,uuid) TO saas_cook_journal_writer;
 GRANT SELECT ON control.analytics_attempts TO saas_cook_control_reader;

 CREATE OR REPLACE FUNCTION control.append_deletion(p_install uuid,p_key text,p_payload text)
 RETURNS TABLE(sequence bigint,previous text,hash text,payload text)
 LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,control AS $body$
 DECLARE h control.journal_heads; e control.deletion_journal; digest text;
 BEGIN
 IF octet_length(p_payload)>262144 OR length(p_key)>160 OR length(p_key)<8 OR
 (p_payload::jsonb->>'version') IS DISTINCT FROM '1' OR
 (p_payload::jsonb->>'subjectKind') NOT IN ('account','organization') OR
 (p_payload::jsonb->>'action') NOT IN ('scheduled','canceled','progress','completed') THEN
 RAISE EXCEPTION 'Invalid journal record'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('journal:'||p_install::text,0));
 INSERT INTO control.journal_heads(installation_id) VALUES(p_install) ON CONFLICT DO NOTHING;
 SELECT * INTO e FROM control.deletion_journal j WHERE j.installation_id=p_install AND j.event_key=p_key;
 IF FOUND THEN
 IF e.payload<>p_payload THEN RAISE EXCEPTION 'Journal operation conflict'; END IF;
 RETURN QUERY SELECT e.sequence,e.previous,e.hash,e.payload; RETURN; END IF;
 SELECT * INTO h FROM control.journal_heads j WHERE j.installation_id=p_install FOR UPDATE;
 digest:=encode(sha256(convert_to(h.hash||E'\\n'||(h.sequence+1)::text||E'\\n'||p_payload,'UTF8')),'hex');
 INSERT INTO control.deletion_journal VALUES(p_install,h.sequence+1,p_key,h.hash,digest,p_payload,clock_timestamp());
 UPDATE control.journal_heads SET sequence=h.sequence+1,hash=digest WHERE installation_id=p_install;
 RETURN QUERY SELECT h.sequence+1,h.hash,digest,p_payload;
 END $body$;
 REVOKE ALL ON FUNCTION control.append_deletion(uuid,text,text) FROM PUBLIC;
 GRANT USAGE ON SCHEMA control TO saas_cook_journal_writer;
 GRANT EXECUTE ON FUNCTION control.append_deletion(uuid,text,text) TO saas_cook_journal_writer;
 GRANT SELECT ON control.journal_heads,control.deletion_journal TO saas_cook_control_reader;
 `);
}
export function validateDeletionRecord(raw: unknown): DeletionRecord {
	const r = raw as DeletionRecord;
	if (
		r?.version !== 1 ||
		!["account", "organization"].includes(r.subjectKind) ||
		!["scheduled", "canceled", "progress", "completed"].includes(r.action) ||
		!/^[a-zA-Z0-9_-]{1,128}$/.test(r.subjectId) ||
		!/^[a-f0-9-]{36}$/.test(r.requestId) ||
		!Number.isFinite(Date.parse(r.effectiveAt)) ||
		![r.retained, r.organizations, r.steps].every(
			(v) =>
				Array.isArray(v) &&
				v.length <= 1000 &&
				v.every((s) => typeof s === "string" && s.length <= 160),
		) ||
		Object.keys(r).some(
			(k) =>
				![
					"version",
					"requestId",
					"subjectKind",
					"subjectId",
					"action",
					"effectiveAt",
					"retained",
					"statusHash",
					"organizations",
					"resolutions",
					"steps",
				].includes(k),
		)
	)
		throw new Error("Invalid deletion journal payload");
	if (r.statusHash !== undefined && !/^[a-f0-9]{64}$/.test(r.statusHash))
		throw new Error("Invalid deletion status hash");
	if (
		r.resolutions !== undefined &&
		(!Array.isArray(r.resolutions) ||
			r.resolutions.length > 1000 ||
			r.resolutions.some(
				(v) =>
					!v ||
					Object.keys(v).some(
						(k) =>
							!["organizationId", "successorUserId", "transferId"].includes(k),
					) ||
					!/^[a-f0-9-]{36}$/.test(v.organizationId) ||
					!/^[a-zA-Z0-9_-]{1,128}$/.test(v.successorUserId) ||
					(v.transferId !== null && !/^[a-f0-9-]{36}$/.test(v.transferId)),
			))
	)
		throw new Error("Invalid ownership resolution");
	return r;
}
export async function appendDeletion(
	pool: Pool,
	installationId: string,
	eventKey: string,
	record: DeletionRecord,
) {
	validateDeletionRecord(record);
	const r = await pool.query<JournalEntry>(
		"SELECT * FROM control.append_deletion($1,$2,$3)",
		[installationId, eventKey, JSON.stringify(record)],
	);
	return { ...r.rows[0], sequence: Number(r.rows[0].sequence) };
}
/** Verify every link against the separately retained head; missing/truncated history fails closed. */
export async function readDeletionJournal(
	c: Pool | PoolClient,
	installationId: string,
) {
	const head = (
		await c.query<{ sequence: string; hash: string }>(
			"SELECT sequence,hash FROM control.journal_heads WHERE installation_id=$1",
			[installationId],
		)
	).rows[0];
	if (!head) throw new Error("Independent journal checkpoint missing");
	const entries: (JournalEntry & { record: DeletionRecord })[] = [];
	let sequence = 0,
		previous = zero;
	while (sequence < Number(head.sequence)) {
		const rows = (
			await c.query<JournalEntry>(
				"SELECT sequence,previous,hash,payload FROM control.deletion_journal WHERE installation_id=$1 AND sequence>$2 AND sequence<=$3 ORDER BY sequence LIMIT 100",
				[installationId, sequence, head.sequence],
			)
		).rows;
		if (!rows.length) throw new Error("Incomplete deletion journal");
		for (const row of rows) {
			const next = Number(row.sequence);
			if (
				next !== sequence + 1 ||
				row.previous !== previous ||
				row.hash !== hash(`${previous}\n${next}\n${row.payload}`)
			)
				throw new Error("Invalid deletion journal chain");
			entries.push({
				...row,
				sequence: next,
				record: validateDeletionRecord(JSON.parse(row.payload)),
			});
			sequence = next;
			previous = row.hash;
		}
	}
	if (previous !== head.hash)
		throw new Error("Invalid deletion journal checkpoint");
	return { sequence, hash: previous, entries };
}

import assert from "node:assert/strict";
import { parseCsv } from "../../packages/db/src/bulk/csv";

/**
 * Verify each sparse-list row against the fixture's independent permission allowlist.
 * @param items Rows returned by one real HTTP page; empty continuing pages are allowed.
 * @param permittedIds Exactly the initially granted 1% of hot-tenant Project IDs.
 * @throws AssertionError for unauthorized, duplicate or over-limit rows. Callers must abort
 * the benchmark on failure: an authorization violation cannot use the availability error budget.
 */
export function assertSparsePage(
	items: readonly { id: string }[],
	permittedIds: ReadonlySet<string>,
) {
	assert(items.length <= 10, "Sparse page exceeded its requested bound");
	assert.equal(
		new Set(items.map((row) => row.id)).size,
		items.length,
		"Sparse page duplicated a Project",
	);
	assert(
		items.every((row) => permittedIds.has(row.id)),
		"Sparse page exposed an unauthorized Project",
	);
}

/**
 * Verify an export contains exactly the fixture member's permitted Projects and fields.
 * @param download Real HTTP download response; CSV decoding uses the bounded CSV parser.
 * @param permittedIds The stable Project IDs granted to the export principal.
 * @throws AssertionError or ResourceError for malformed data, unexpected fields, missing,
 * extra or duplicate rows. IDs appearing only in another cell cannot satisfy this assertion.
 */
export function assertAuthorizedExport(
	download: { filename: string; contentType: string; base64: string },
	permittedIds: ReadonlySet<string>,
) {
	assert.equal(download.filename, "projects.csv");
	assert.equal(download.contentType, "text/csv");
	const [headers, ...rows] = parseCsv(
		Buffer.from(download.base64, "base64").toString("utf8"),
	);
	assert.deepEqual(headers, ["id", "name", "slug", "description", "status"]);
	assert.equal(
		rows.length,
		permittedIds.size,
		"Export changed the authorized row count",
	);
	const returnedIds = rows.map((row) => row[0]);
	assert.equal(
		new Set(returnedIds).size,
		returnedIds.length,
		"Export duplicated a Project",
	);
	assert(
		returnedIds.every((id) => permittedIds.has(id)),
		"Export exposed an unauthorized Project",
	);
}

/**
 * Derive final status only after cleanup, keeping smoke and failed runs ineligible.
 * @param run Prior execution status, smoke mode, named checks and actual cleanup outcome.
 * @returns Consistent report status/eligibility fields; no I/O or mutation is performed.
 */
export function finalPerformanceOutcome(run: {
	status: string;
	smoke: boolean;
	checks: Record<string, boolean>;
	cleanupPassed: boolean;
}) {
	const passed =
		run.status === "passed" &&
		run.cleanupPassed &&
		Object.values(run.checks).length > 0 &&
		Object.values(run.checks).every(Boolean);
	return {
		status: passed ? "passed" : "failed",
		acceptanceEligible: passed && !run.smoke,
		cleanupPassed: run.cleanupPassed,
	};
}

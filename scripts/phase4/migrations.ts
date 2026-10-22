import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import historyReset from "./saas-cook-history-reset.json";

type Journal = { entries: { idx: number; when: number; tag: string }[] };
const directory = "packages/db/migrations";
// Explicit disposable reset, documented in docs/feature-briefs/saas-cook-rename.md.
// Exact content pairs permit only that reviewed transition, never later edits.
const reviewedReset: Record<string, { before: string; after: string }> =
	historyReset;
const digest = (content: string) =>
	createHash("sha256").update(content).digest("hex");

export async function checkMigrations(
	root: string,
	base = "HEAD",
): Promise<string[]> {
	const failures: string[] = [];
	const folder = path.join(root, directory);
	const journal = JSON.parse(
		await readFile(path.join(folder, "meta/_journal.json"), "utf8"),
	) as Journal;
	const files = await readdir(folder);
	const snapshots = await readdir(path.join(folder, "meta"));
	let previousId = "00000000-0000-0000-0000-000000000000";
	const ids = new Set<string>();
	for (const [index, entry] of journal.entries.entries()) {
		const prefix = index.toString().padStart(4, "0");
		if (
			entry.idx !== index ||
			!entry.tag.startsWith(`${prefix}_`) ||
			(index > 0 && entry.when <= journal.entries[index - 1].when)
		)
			failures.push(`${entry.tag}: migration journal order is inconsistent`);
		if (!files.includes(`${entry.tag}.sql`))
			failures.push(`${entry.tag}: missing reviewed SQL`);
		const snapshotName = `${prefix}_snapshot.json`;
		if (!snapshots.includes(snapshotName)) {
			failures.push(`${entry.tag}: missing schema snapshot`);
			continue;
		}
		const snapshot = JSON.parse(
			await readFile(path.join(folder, "meta", snapshotName), "utf8"),
		);
		if (snapshot.prevId !== previousId || ids.has(snapshot.id))
			failures.push(`${entry.tag}: broken snapshot ancestry`);
		previousId = snapshot.id;
		ids.add(snapshot.id);
		if (snapshot.dialect !== "postgresql" || snapshot.version !== "7")
			failures.push(`${entry.tag}: unsupported schema snapshot`);
	}
	for (const file of files.filter((name) => name.endsWith(".sql")))
		if (!journal.entries.some((entry) => file === `${entry.tag}.sql`))
			failures.push(`${file}: unjournaled migration`);
	for (const file of snapshots.filter((name) =>
		name.endsWith("_snapshot.json"),
	))
		if (
			!journal.entries.some(
				(entry) =>
					file === `${entry.idx.toString().padStart(4, "0")}_snapshot.json`,
			)
		)
			failures.push(`${file}: unjournaled snapshot`);
	// Fail closed for an invalid base; CI supplies the PR base or previous main commit.
	const git = (args: string[]) =>
		execFileSync("git", args, {
			cwd: root,
			encoding: "utf8",
			stdio: ["ignore", "pipe", "pipe"],
		});
	const oldJournal = JSON.parse(
		git(["show", `${base}:${directory}/meta/_journal.json`]),
	) as Journal;
	for (const entry of oldJournal.entries) {
		if (JSON.stringify(journal.entries[entry.idx]) !== JSON.stringify(entry))
			failures.push(
				`${entry.tag}: published journal entry changed since ${base}`,
			);
		for (const relative of [
			`${entry.tag}.sql`,
			`meta/${entry.idx.toString().padStart(4, "0")}_snapshot.json`,
		]) {
			const oldContent = git(["show", `${base}:${directory}/${relative}`]);
			const current = await readFile(path.join(folder, relative), "utf8").catch(
				() => null,
			);
			const reset = reviewedReset[relative];
			if (
				current !== oldContent &&
				!(
					reset &&
					current !== null &&
					digest(oldContent) === reset.before &&
					digest(current) === reset.after
				)
			)
				failures.push(
					`${relative}: applied migration history changed since ${base}`,
				);
		}
	}
	return failures;
}

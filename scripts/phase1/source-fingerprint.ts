import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { promisify } from "node:util";

const exec = promisify(execFile);
/** Fingerprint implementation inputs; evidence/docs are excluded to avoid self-reference. */
export async function sourceFingerprint() {
	const files = (
		await exec("git", ["ls-files", "-co", "--exclude-standard", "-z"])
	).stdout
		.split("\0")
		.filter(Boolean)
		.filter((path) =>
			/^(apps\/|packages\/|infra\/|scripts\/phase[123]\/|tests\/|\.github\/|package\.json$|bun\.lock$|tsconfig.*\.json$|turbo\.json$|biome\.json$|(?:playwright|vitest|knip|commitlint)\.config\.ts$|lefthook\.yml$|\.dockerignore$)/.test(
				path,
			),
		)
		.sort();
	const hash = createHash("sha256");
	for (const path of files) {
		hash.update(`${path}\0`);
		try {
			hash.update(await readFile(path));
		} catch (error) {
			if (
				!(error instanceof Error && "code" in error && error.code === "ENOENT")
			)
				throw error;
			hash.update("<deleted>");
		}
		hash.update("\0");
	}
	return hash.digest("hex");
}

import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

const exec = promisify(execFile);
/**
 * Hash tracked and untracked implementation inputs in the current checkout.
 * Documentation and generated evidence are excluded to avoid self-reference.
 * The optional root selects an isolated checkout; defaults to the working directory.
 * Returns a SHA-256 digest; unexpected Git or filesystem failures propagate.
 */
export async function sourceFingerprint(root = process.cwd()) {
	const files = (
		await exec("git", ["ls-files", "-co", "--exclude-standard", "-z"], {
			cwd: root,
		})
	).stdout
		.split("\0")
		.filter(Boolean)
		.filter((path) =>
			/^(apps\/|packages\/|infra\/|scripts\/|tests\/|evaluations\/|\.agents\/|\.github\/|package\.json$|bun\.lock$|tsconfig.*\.json$|turbo\.json$|biome\.json$|(?:playwright(?:\.[a-z0-9-]+)?|vitest(?:\.[a-z0-9-]+)?|knip|commitlint)\.config\.ts$|lefthook\.yml$|\.dockerignore$)/.test(
				path,
			),
		)
		.sort();
	const hash = createHash("sha256");
	for (const file of new Set(files)) {
		hash.update(`${file}\0`);
		try {
			hash.update(await readFile(path.join(root, file)));
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

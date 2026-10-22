import { copyFile, mkdir, readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";

function reportDirectory(value: string) {
	if (
		!/^artifacts\/phase8\/[a-zA-Z0-9._/-]+$/.test(value) ||
		value.split("/").some((part) => part === ".." || part === "." || !part)
	)
		throw new Error(
			"Phase 8 reports must stay in an explicit artifacts/phase8 directory",
		);
	return value;
}

/**
 * Choose Playwright report locations without changing spec labels used by service fixtures.
 * @param kind - Customer-browser or Storybook/theme configuration.
 * @param env - Explicit environment; optional phase8 destination and single-segment spec group.
 * @returns Isolated result/HTML/JSON paths, or the existing ordinary command defaults.
 * Invalid destinations/groups throw before Playwright can clean any output directory.
 */
export function playwrightEvidencePaths(
	kind: "browser" | "theme",
	env: Record<string, string | undefined>,
) {
	const group = env.E2E_REPORT_GROUP;
	if (group !== undefined && !/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,100}$/.test(group))
		throw new Error("E2E_REPORT_GROUP must be one safe spec label");
	const destination = env.PHASE8_REPORT_DIRECTORY;
	if (destination) {
		const base = `${reportDirectory(destination)}/${kind}${kind === "browser" ? `/${group ?? "filtered"}` : ""}`;
		return {
			results: `${base}/results`,
			html: `${base}/report`,
			json: `${base}/results.json`,
		};
	}
	if (kind === "theme")
		return {
			results: "artifacts/theme/results",
			html: "artifacts/theme/report",
			json: "artifacts/theme/results.json",
		};
	const results = group
		? `artifacts/playwright-results/${group}`
		: "artifacts/playwright-results";
	return {
		results,
		html: group ? `artifacts/playwright/${group}` : "artifacts/playwright",
		json: `${results}/results.json`,
	};
}

/**
 * Route structured outputs into an attempt-owned directory for repository gate commands.
 * @param directory - Relative artifacts/phase8 command directory validated before child launch.
 * @param env - Calling environment; runtime/service settings and E2E_REPORT_GROUP are preserved.
 * @returns Child environment with isolated Vitest/Playwright/scanner outputs. Ambient reporter
 * override paths are removed so they cannot silently redirect evidence outside the attempt.
 */
export function verificationEnvironment(
	directory: string,
	env: NodeJS.ProcessEnv,
): NodeJS.ProcessEnv {
	reportDirectory(directory);
	const result = { ...env };
	for (const key of Object.keys(result))
		if (/^PLAYWRIGHT_(JSON|HTML|JUNIT)_(OUTPUT_|REPORT$)/.test(key))
			delete result[key];
	return {
		...result,
		NO_COLOR: "1",
		PHASE8_REPORT_DIRECTORY: directory,
		VITEST_REPORT: `${directory}/vitest.xml`,
		SECURITY_ARTIFACT_DIRECTORY: `${directory}/security`,
	};
}

/**
 * Retain nested skill/compatibility output and enumerate complete command-owned reports.
 * @param command - Repository script name; only known legacy output locations are copied.
 * @param directory - Validated command directory, never a build/candidate source tree.
 * @param startedAt - Child launch time; fixed legacy manifests older than the attempt are ignored.
 * @returns Sorted relative artifact paths to hash, including failure diagnostics/axe attachments.
 * Rejects symlinks and unexpectedly large trees; it never deletes evidence or follows external links.
 */
export async function collectVerificationArtifacts(
	command: string,
	directory: string,
	startedAt: number,
) {
	reportDirectory(directory);
	if (command === "skills:check") {
		const log = await readFile(`${directory}/command.log`, "utf8");
		const match = log.match(
			/Evidence: (artifacts\/phase4\/checks\/[0-9]+-[a-f0-9-]+)\/report\.json/,
		);
		if (match) {
			const destination = `${directory}/skills`;
			await mkdir(destination, { recursive: true });
			for (const entry of await readdir(match[1], { withFileTypes: true })) {
				if (!entry.isFile() || !/\.(json|xml|log)$/.test(entry.name)) continue;
				await copyFile(
					path.join(match[1], entry.name),
					path.join(destination, entry.name),
				);
			}
		}
	}
	if (command === "phase8:compatibility") {
		for (const name of [
			"customer-compatibility.json",
			"backoffice-compatibility.json",
		]) {
			const source = `artifacts/phase8/${name}`;
			const information = await stat(source).catch(
				(error: NodeJS.ErrnoException) => {
					if (error.code === "ENOENT") return null;
					throw error;
				},
			);
			if (information?.isFile() && information.mtimeMs >= startedAt)
				await copyFile(source, `${directory}/${name}`);
		}
	}
	const files: string[] = [];
	let totalBytes = 0;
	async function visit(current: string) {
		for (const entry of await readdir(current, { withFileTypes: true })) {
			const file = path.join(current, entry.name);
			if (entry.isSymbolicLink())
				throw new Error("Evidence reports must not contain symlinks");
			if (entry.isDirectory()) {
				if (
					["node_modules", "candidate", "dist", ".next", ".turbo"].includes(
						entry.name,
					)
				)
					throw new Error(
						"Build/dependency trees are not verification reports",
					);
				await visit(file);
			} else if (entry.isFile()) {
				files.push(file);
				totalBytes += (await stat(file)).size;
				if (files.length > 20_000 || totalBytes > 512 * 1024 * 1024)
					throw new Error(
						"Verification report collection exceeds bounded evidence budget",
					);
			}
		}
	}
	await visit(directory);
	return files.sort();
}

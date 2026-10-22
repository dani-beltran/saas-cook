import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";

const names = [
	"saas-bootstrap",
	"saas-add-feature",
	"saas-evolve-feature",
	"saas-add-dashboard-page",
	"saas-add-email",
	"saas-verify-feature",
];

/** Validate the shipped portable catalogue, not generated wording or agent behavior. */
export async function checkSkills(root: string): Promise<string[]> {
	const failures: string[] = [];
	const files: string[] = [];
	for (const name of names) {
		const file = `.agents/skills/${name}/SKILL.md`;
		files.push(file);
		try {
			const source = await readFile(path.join(root, file), "utf8");
			const metadata = /^---\n([\s\S]*?)\n---\n/.exec(source)?.[1];
			if (!metadata?.split("\n").includes(`name: ${name}`))
				failures.push(`${file}: missing or mismatched skill name`);
			if (!/^description: .+$/m.test(metadata ?? ""))
				failures.push(`${file}: missing discovery description`);
		} catch {
			failures.push(`${file}: missing skill`);
		}
	}
	for (const directory of ["docs/development", "docs/feature-briefs"]) {
		for (const entry of await readdir(path.join(root, directory)))
			if (entry.endsWith(".md")) files.push(`${directory}/${entry}`);
	}
	for (const file of files) {
		let source: string;
		try {
			source = await readFile(path.join(root, file), "utf8");
		} catch {
			continue;
		}
		for (const match of source.matchAll(/\[[^\]]*\]\(([^)]+)\)/g)) {
			const target = match[1].split("#")[0];
			if (!target || /^[a-z][a-z0-9+.-]*:/i.test(target)) continue;
			const resolved = path.resolve(root, path.dirname(file), target);
			if (!resolved.startsWith(`${path.resolve(root)}${path.sep}`)) {
				failures.push(`${file}: local reference escapes repository: ${target}`);
				continue;
			}
			try {
				await stat(resolved);
			} catch {
				failures.push(`${file}: missing reference: ${target}`);
			}
		}
	}
	return failures;
}

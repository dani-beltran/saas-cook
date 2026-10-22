import { mkdir, readFile, writeFile } from "node:fs/promises";
import { evidenceSource } from "./evidence";
import { checkReleaseIndex, releaseGates } from "./release-check";

const file = process.argv[2];
if (!file)
	throw new Error("Usage: bun run phase8:release INDEX.json or --template");
await mkdir("artifacts/phase8", { recursive: true });
if (file === "--template") {
	const source = await evidenceSource();
	await writeFile(
		"artifacts/phase8/release-input.example.json",
		`${JSON.stringify({ version: 1, source: { commit: source.commit, fingerprint: source.fingerprint }, entries: releaseGates.map((gate) => ({ gate, receipt: null, sha256: null })) }, null, 2)}\n`,
	);
	console.log(
		"Fill artifacts/phase8/release-input.example.json with actual immutable receipts; null entries cannot pass.",
	);
} else {
	try {
		const index = await checkReleaseIndex(
			JSON.parse(await readFile(file, "utf8")),
		);
		const current = await evidenceSource();
		if (
			current.dirty ||
			current.commit !== index.source.commit ||
			current.fingerprint !== index.source.fingerprint
		)
			throw new Error("Release checkout differs from the evidence source");
		await writeFile(
			"artifacts/phase8/release-readiness.json",
			`${JSON.stringify({ status: "evidence-complete", source: index.source, gates: releaseGates, checkedAt: new Date().toISOString(), releaseAccepted: false, remaining: ["Review the actual evidence and limitations", "Verify the merged main commit and hosted CI", "Record roadmap sign-off before creating a release tag"] }, null, 2)}\n`,
		);
		console.log(
			"Evidence integrity is complete. Review and merged-source sign-off are still required; no tag was created.",
		);
	} catch {
		await writeFile(
			"artifacts/phase8/release-readiness.json",
			`${JSON.stringify({ status: "blocked", releaseAccepted: false, checkedAt: new Date().toISOString(), reason: "Missing, failed, stale or invalid evidence; inspect the index and retained receipts" }, null, 2)}\n`,
		);
		console.error(
			"Release evidence validation failed; acceptance remains pending.",
		);
		process.exitCode = 1;
	}
}

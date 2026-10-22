import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { z } from "zod";
import { evidenceSchema } from "./evidence";

/** Required independent release gates; a missing or failed gate keeps release acceptance open. */
export const releaseGates = [
	"source",
	"unit",
	"integration",
	"browser",
	"storybook",
	"build",
	"image-customer",
	"image-backoffice",
	"security-dependencies",
	"performance-full",
	"recovery",
	"compatibility",
	"accessibility",
	"template",
	"skills",
] as const;
const artifactPath = z
	.string()
	.regex(/^artifacts\/[a-zA-Z0-9._/-]+$/)
	.refine((value) => !value.split("/").includes(".."));
const indexSchema = z.strictObject({
	version: z.literal(1),
	source: z.strictObject({
		commit: z.string().regex(/^[a-f0-9]{40}$/),
		fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
	}),
	entries: z.array(
		z.strictObject({
			gate: z.enum(releaseGates),
			receipt: artifactPath,
			sha256: z.string().regex(/^[a-f0-9]{64}$/),
		}),
	),
});

/**
 * Validate a release index against immutable receipt bytes and their supporting artifacts.
 * Input is untrusted JSON; read defaults to the local filesystem and may be supplied by tests.
 * Every required gate must appear exactly once, pass, and bind the declared source. Returns
 * the validated index; malformed/missing/stale/tampered evidence throws. This checks evidence
 * integrity and completeness, not the truth of an external author's assertions or merge state.
 */
export async function checkReleaseIndex(
	input: unknown,
	read: (file: string) => Promise<Uint8Array> = readFile,
) {
	const index = indexSchema.parse(input);
	if (
		index.entries.length !== releaseGates.length ||
		new Set(index.entries.map((entry) => entry.gate)).size !==
			releaseGates.length
	)
		throw new Error("Every release gate needs exactly one receipt");
	for (const entry of index.entries) {
		const bytes = await read(entry.receipt);
		if (createHash("sha256").update(bytes).digest("hex") !== entry.sha256)
			throw new Error(`Receipt digest mismatch: ${entry.gate}`);
		const receipt = evidenceSchema.parse(
			JSON.parse(Buffer.from(bytes).toString("utf8")),
		);
		if (
			receipt.gate !== entry.gate ||
			receipt.outcome !== "passed" ||
			receipt.source.commit !== index.source.commit ||
			receipt.source.fingerprint !== index.source.fingerprint ||
			receipt.source.dirty
		)
			throw new Error(
				`Receipt is failed, stale, dirty or for a different gate: ${entry.gate}`,
			);
		if (!receipt.artifacts.length)
			throw new Error(`Supporting artifacts are required: ${entry.gate}`);
		if (entry.gate.startsWith("image-") && !receipt.image)
			throw new Error(`Immutable image identity is required: ${entry.gate}`);
		for (const artifact of receipt.artifacts) {
			artifactPath.parse(artifact.path);
			if (
				createHash("sha256")
					.update(await read(artifact.path))
					.digest("hex") !== artifact.sha256
			)
				throw new Error(`Supporting artifact digest mismatch: ${entry.gate}`);
		}
	}
	return index;
}

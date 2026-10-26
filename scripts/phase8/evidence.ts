import { execFile } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { z } from "zod";
import { sourceFingerprint } from "../phase1/source-fingerprint";

const exec = promisify(execFile);
const label = z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9 ._:/-]{0,159}$/);
const hash = z.string().regex(/^[a-f0-9]{64}$/);
const imageSchema = z.strictObject({
	id: z.string().regex(/^sha256:[a-f0-9]{64}$/),
	architecture: label,
	os: label,
	revision: z.string().regex(/^[a-f0-9]{40}$/),
	fingerprint: hash,
});

/** Versioned release evidence; callers must not put secrets or raw errors in labels. */
export const evidenceSchema = z
	.strictObject({
		version: z.literal(1),
		gate: label,
		preset: z.enum([
			"foundation",
			"commercial-local",
			"commercial-provider",
			"backoffice",
		]),
		startedAt: z.iso.datetime(),
		finishedAt: z.iso.datetime(),
		outcome: z.enum(["passed", "failed"]),
		source: z.strictObject({
			commit: z.string().regex(/^[a-f0-9]{40}$/),
			fingerprint: hash,
			dirty: z.boolean(),
		}),
		image: imageSchema.optional(),
		checks: z
			.array(z.strictObject({ name: label, passed: z.boolean() }))
			.min(1),
		limitations: z.array(label),
		artifacts: z.array(
			z.strictObject({
				path: z.string().regex(/^artifacts\/[a-zA-Z0-9._/-]+$/),
				sha256: hash,
			}),
		),
	})
	.superRefine((receipt, ctx) => {
		if (Date.parse(receipt.finishedAt) < Date.parse(receipt.startedAt))
			ctx.addIssue({
				code: "custom",
				message: "Evidence time order is invalid",
			});
		if (
			receipt.outcome === "passed" &&
			receipt.checks.some((check) => !check.passed)
		)
			ctx.addIssue({
				code: "custom",
				message: "Failed checks cannot produce passed evidence",
			});
		if (
			new Set(receipt.checks.map((check) => check.name)).size !==
			receipt.checks.length
		)
			ctx.addIssue({
				code: "custom",
				message: "Duplicate checks are ambiguous",
			});
		if (
			receipt.image &&
			(receipt.image.fingerprint !== receipt.source.fingerprint ||
				receipt.image.revision !== receipt.source.commit)
		)
			ctx.addIssue({
				code: "custom",
				message: "Image does not match the evidence source",
			});
	});

/** Capture the checkout commit, implementation digest and dirty state without reading credentials. */
export async function evidenceSource() {
	return {
		commit: (await exec("git", ["rev-parse", "HEAD"])).stdout.trim(),
		fingerprint: await sourceFingerprint(),
		dirty: Boolean(
			(await exec("git", ["status", "--porcelain"])).stdout.trim(),
		),
	};
}

/** Resolve a local image reference to immutable metadata; throws on missing or malformed labels. */
export async function evidenceImage(reference: string) {
	const result = await exec("docker", ["image", "inspect", reference], {
		maxBuffer: 4 * 1024 * 1024,
	});
	const [image] = JSON.parse(result.stdout);
	return imageSchema.parse({
		id: image.Id,
		architecture: image.Architecture,
		os: image.Os,
		revision: image.Config?.Labels?.["org.opencontainers.image.revision"],
		fingerprint: image.Config?.Labels?.["dev.saas-cook.source-fingerprint"],
	});
}

/**
 * Validate and persist one immutable attempt receipt in artifacts/phase8.
 * Input labels must be static descriptions, never command arguments or raw failures.
 * Missing artifacts, mismatched image/source and invalid outcomes throw before writing.
 * Returns the relative receipt path; files are exclusive and never overwrite earlier attempts.
 */
export async function writeEvidence(
	input: Omit<
		z.input<typeof evidenceSchema>,
		"version" | "finishedAt" | "artifacts"
	>,
	artifactPaths: string[] = [],
) {
	const artifacts = await Promise.all(
		artifactPaths.map(async (file) => {
			if (
				!/^artifacts\/[a-zA-Z0-9._/-]+$/.test(file) ||
				file.split("/").includes("..")
			)
				throw new Error("Evidence artifacts must stay under artifacts/");
			return {
				path: file,
				sha256: createHash("sha256")
					.update(await readFile(file))
					.digest("hex"),
			};
		}),
	);
	const receipt = evidenceSchema.parse({
		...input,
		version: 1,
		finishedAt: new Date().toISOString(),
		artifacts,
	});
	const directory = "artifacts/phase8/receipts";
	await mkdir(directory, { recursive: true });
	const destination = path.join(directory, `${randomUUID()}.json`);
	await writeFile(destination, `${JSON.stringify(receipt, null, 2)}\n`, {
		flag: "wx",
	});
	return destination;
}

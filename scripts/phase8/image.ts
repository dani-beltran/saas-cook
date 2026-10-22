import { execFile, spawn } from "node:child_process";
import { isDeepStrictEqual, promisify } from "node:util";
import { compatibilityManifest } from "./compatibility-contract";
import { evidenceImage, evidenceSource, writeEvidence } from "./evidence";

const target = process.argv[2];
if (target !== "customer" && target !== "backoffice")
	throw new Error("Usage: bun run phase8:image customer|backoffice");
const startedAt = new Date().toISOString();
const source = await evidenceSource();
const checks: Array<{ name: string; passed: boolean }> = [];
let image: Awaited<ReturnType<typeof evidenceImage>> | undefined;
const preset = target === "customer" ? "commercial-local" : "backoffice";
try {
	image = await evidenceImage(
		target === "customer"
			? (process.env.TEST_IMAGE ?? "saas-cook:phase2")
			: (process.env.BACKOFFICE_TEST_IMAGE ?? "saas-cook-backoffice:local"),
	);
	checks.push({
		name: "source-image-binding",
		passed:
			image.fingerprint === source.fingerprint &&
			image.revision === source.commit,
	});
	if (!checks.at(-1)?.passed)
		throw new Error("Build the image from this checkout before verification");
	const manifestPath =
		target === "customer"
			? "/app/dist/compatibility.json"
			: "/app/compatibility.json";
	const embedded = await promisify(execFile)("docker", [
		"run",
		"--rm",
		"--network",
		"none",
		"--entrypoint",
		"/nodejs/bin/node",
		image.id,
		"-e",
		`process.stdout.write(require('node:fs').readFileSync('${manifestPath}','utf8'))`,
	]);
	checks.push({
		name: "embedded-compatibility-contract",
		passed: isDeepStrictEqual(
			JSON.parse(embedded.stdout),
			await compatibilityManifest(target),
		),
	});
	if (!checks.at(-1)?.passed)
		throw new Error(
			"Embedded image compatibility contract does not match source",
		);
	for (const command of [
		target === "customer" ? "test:image" : "test:image:backoffice",
		"security:scan",
	]) {
		const code = await new Promise<number>((resolve, reject) => {
			const child = spawn(
				"bun",
				[
					"run",
					command,
					...(command === "security:scan" ? ["image", image?.id ?? ""] : []),
				],
				{
					stdio: "inherit",
					env: {
						...process.env,
						TEST_IMAGE: image?.id,
						BACKOFFICE_TEST_IMAGE: image?.id,
					},
				},
			);
			child.once("error", reject);
			child.once("exit", (code) => resolve(code ?? 1));
		});
		checks.push({ name: command, passed: code === 0 });
		if (code !== 0) throw new Error("Required image check failed");
	}
	checks.push({
		name: "stable-source",
		passed: source.fingerprint === (await evidenceSource()).fingerprint,
	});
	if (!checks.at(-1)?.passed)
		throw new Error("Source changed during image verification");
	console.log(
		await writeEvidence(
			{
				gate: `image-${target}`,
				preset,
				startedAt,
				source,
				image,
				outcome: "passed",
				checks,
				limitations: [
					"Local image acceptance does not establish production availability",
				],
			},
			[
				target === "customer"
					? "artifacts/image/acceptance.json"
					: "artifacts/backoffice/image.json",
			],
		),
	);
} catch {
	checks.push({ name: "verification-completed", passed: false });
	// A mismatched image is recorded as a failed binding check, never as current-source image evidence.
	console.error(
		await writeEvidence({
			gate: `image-${target}`,
			preset,
			startedAt,
			source,
			...(image?.fingerprint === source.fingerprint &&
			image?.revision === source.commit
				? { image }
				: {}),
			outcome: "failed",
			checks,
			limitations: ["See retained verification diagnostics"],
		}),
	);
	process.exitCode = 1;
}

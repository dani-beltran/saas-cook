import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFile, lstat, mkdir, readFile, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { dirname, join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { promisify } from "node:util";
import { readServeEnv } from "../../packages/config/src/server";
import { snapshotEvaluationSource } from "../phase4/evaluation";

const exec = promisify(execFile);
// Reviewed link/brief relocation delta from the Phase 5 trial; see docs/phase8/template.md.
const reviewedSkillHashes: Record<string, string> = {
	".agents/skills/saas-add-dashboard-page/SKILL.md":
		"fa93d45acb5e355ed0aa7ffe75f0286b4ceb9c047a87496ed3b6557455f967be",
	".agents/skills/saas-add-email/SKILL.md":
		"e964dbb5d10884f760361d32cda6cab804ecaa6f324b2714ad727ad1937086b9",
	".agents/skills/saas-add-feature/SKILL.md":
		"3a41821925ffb3e8ae158a6b6a93ae432fb0bcb94efa58c0e33a8d19fc3baa1d",
	".agents/skills/saas-bootstrap/SKILL.md":
		"ab3aff6a9a598b713388bc73f93cbadbf740602297adb564bd5521f5b733c8e1",
	".agents/skills/saas-evolve-feature/SKILL.md":
		"ca7bd2fe1618b407406c7884a5fe114fdbfeee78d6ba3e7b793d92b3082db1ee",
	".agents/skills/saas-verify-feature/SKILL.md":
		"b04e4f07b2a155c895ba16a82dba04c93e45c087e15658b1a0e38e190d223d62",
};
const presets = {
	foundation: {
		BILLING_ENABLED: "false",
		FILES_ENABLED: "false",
		PLATFORM_ENABLED: "false",
		ANALYTICS_ENABLED: "false",
	},
	"commercial-local": {
		BILLING_ENABLED: "false",
		FILES_ENABLED: "true",
		PLATFORM_ENABLED: "true",
		ANALYTICS_ENABLED: "false",
	},
	"commercial-provider": {
		BILLING_ENABLED: "true",
		FILES_ENABLED: "true",
		PLATFORM_ENABLED: "true",
		ANALYTICS_ENABLED: "true",
	},
} as const;

/**
 * Validates one declared evidence preset through the actual combined-runtime validator.
 * @param name - foundation, commercial-local or commercial-provider; unknown names fail closed.
 * @param env - Explicit environment, never read implicitly from ambient credentials.
 * @returns Validated runtime settings. Throws on missing dependencies or mismatched preset flags.
 * This is a test/receipt adapter; it does not activate modules or call external providers.
 */
export function validateTemplatePreset(
	name: string,
	env: Record<string, string | undefined>,
) {
	if (!Object.hasOwn(presets, name))
		throw new Error("Unknown template evidence preset");
	const expected = presets[name as keyof typeof presets];
	const runtime = readServeEnv(env);
	for (const [flag, value] of Object.entries(expected)) {
		if (runtime[flag as keyof typeof expected] !== value)
			throw new Error("Runtime flags do not match declared evidence preset");
	}
	return runtime;
}

/**
 * Copies a credential-free source fixture using the existing evaluator's filters.
 * @param source - Repository source; never modified.
 * @param candidate - New disposable directory. Existing destinations are rejected.
 * @returns Sorted source paths copied to the candidate, excluding credentials/generated output.
 * Restores tracked evaluator code/history required by the complete downstream command set.
 */
export async function copyTemplateFixture(source: string, candidate: string) {
	const snapshot = await snapshotEvaluationSource(source, candidate);
	const files = Object.keys(snapshot.hashes);
	// Unlike author evaluation copies, an adopted repository includes its evaluator commands/history.
	const restored = (
		await exec(
			"git",
			[
				"ls-files",
				"-z",
				"--",
				"scripts/phase4",
				"docs/phase4",
				"tests/phase4",
				"evaluations",
				"packages/testing/src/phase4.integration.test.ts",
			],
			{ cwd: source },
		)
	).stdout
		.split("\0")
		.filter(Boolean);
	for (const name of restored) {
		if (!(await lstat(join(source, name))).isFile())
			throw new Error("Template inputs must be regular files");
		await mkdir(dirname(join(candidate, name)), { recursive: true });
		await copyFile(join(source, name), join(candidate, name));
		files.push(name);
	}
	await writeFile(
		join(candidate, ".phase8-disposable-template"),
		"synthetic adoption fixture\n",
		{ flag: "wx" },
	);
	return files.sort();
}

const historical =
	/^(spikes\/phase0\/|docs\/phase[0-7]\/|packages\/db\/migrations\/|packages\/authz\/src\/fixtures\/|evaluations\/|\.agents\/)/;
const active =
	/^(apps\/|packages\/|infra\/|scripts\/|tests\/|\.github\/|docs\/development\/)|^(package.json|bun.lock|turbo.json|README.md|\.env.example|.*\.config\.ts|tsconfig.*\.json)$/;
const textFile =
	/\.(tsx?|mjs|cjs|json|css|md|ya?ml)$|(^|\/)Dockerfile$|^bun.lock$|^\.env.example$/;

/**
 * Applies the explicit Northstar Work adoption fixture to allowlisted active source.
 * @param candidate - Disposable copy carrying the marker written by copyTemplateFixture.
 * @param names - Inventoried source paths, never arbitrary replacement instructions.
 * @param limit - Optional changed-file checkpoint to simulate an interrupted adoption.
 * @returns Changed paths; repeating a completed adoption returns an empty array.
 * Historical migrations/models, database roles, signed protocol identifiers and custom files stay byte-identical.
 */
export async function adoptTemplateFixture(
	candidate: string,
	names: string[],
	limit = Number.POSITIVE_INFINITY,
) {
	if (
		(await readFile(join(candidate, ".phase8-disposable-template"), "utf8")) !==
		"synthetic adoption fixture\n"
	)
		throw new Error("Disposable template fixture required");
	const changed: string[] = [];
	for (const name of names) {
		if (name.startsWith("scripts/phase0/")) continue;
		if (historical.test(name) || !active.test(name) || !textFile.test(name))
			continue;
		if (name.split("/").includes("..") || name.startsWith("/"))
			throw new Error("Invalid fixture path");
		const file = join(candidate, name);
		const before = await readFile(file, "utf8");
		let after = before
			.replaceAll("@saas-cook/", "@northstar-work/")
			.replaceAll("SaaS Cook", "Northstar Work");
		if (name === "package.json" || name === "bun.lock")
			after = after.replaceAll(
				'"name": "saas-cook"',
				'"name": "northstar-work"',
			);
		if (name === "package.json" || name.startsWith("scripts/"))
			after = after
				.replaceAll("saas-cook:phase2", "northstar-work:phase2")
				.replaceAll("saas-cook:backoffice", "northstar-work:backoffice");
		if (name === "infra/docker/Dockerfile")
			after = after.replaceAll(
				'org.opencontainers.image.title="saas-cook',
				'org.opencontainers.image.title="northstar-work',
			);
		if (before !== after) {
			await writeFile(file, after);
			changed.push(name);
			if (changed.length >= limit) break;
		}
	}
	return changed;
}

/**
 * Creates a synthetic local environment only when it does not already exist.
 * @param candidate - Disposable copy; existing environment bytes are preserved on resume.
 * @returns true when initialized and false on a repeat. Filesystem errors other than EEXIST propagate.
 */
export async function initializeTemplateEnvironment(candidate: string) {
	if (
		(await readFile(join(candidate, ".phase8-disposable-template"), "utf8")) !==
		"synthetic adoption fixture\n"
	)
		throw new Error("Disposable template fixture required");
	try {
		await writeFile(
			join(candidate, ".env"),
			await readFile(join(candidate, ".env.example")),
			{ flag: "wx" },
		);
		return true;
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "EEXIST") return false;
		throw error;
	}
}

/**
 * Hashes the explicit source inventory without following generated dependency directories.
 * @param root - Fixture root; names are relative source file paths.
 * @param names - Files from copyTemplateFixture, used to compare interrupted/repeated work.
 * @returns A stable path-to-SHA256 map; missing files fail the preservation check.
 */
export async function templateHashes(root: string, names: string[]) {
	const result: Record<string, string> = {};
	for (const name of [...names].sort())
		result[name] = createHash("sha256")
			.update(await readFile(join(root, name)))
			.digest("hex");
	return result;
}

/**
 * Writes a synthetic developer customization whose lower-case customer protocol identifier must survive adoption.
 * @param candidate - Disposable candidate containing the developer-owned source.
 * @returns The path and exact content to verify after adoption and repeats.
 */
export async function seedTemplateCustomization(candidate: string) {
	const name = "apps/web/src/template-customization.ts";
	const content =
		'/** Preserve developer-owned customer protocol identifiers. */\nexport function customerIdentifier() { return "saas-cook:customer-protocol:v1"; }\n';
	await mkdir(dirname(join(candidate, name)), { recursive: true });
	await writeFile(join(candidate, name), content);
	return { name, content };
}

/**
 * Return synthetic validation inputs for one declared preset; no provider is contacted.
 * @param name - Exact supported preset name; unknown values are rejected.
 * @returns Separate runtime-role URLs and intentionally nonfunctional provider credentials.
 */
export function templatePresetEnvironment(
	name: string,
): Record<string, string> {
	if (!Object.hasOwn(presets, name))
		throw new Error("Unknown template evidence preset");
	const env: Record<string, string> = {
		DATABASE_URL: "postgres://web:synthetic@localhost/app",
		WORKER_DATABASE_URL: "postgres://worker:synthetic@localhost/app",
		IDENTITY_DATABASE_URL: "postgres://identity:synthetic@localhost/app",
		CONTROL_DATABASE_URL: "postgres://reader:synthetic@localhost/control",
		APP_ORIGIN: "https://example.test",
		APP_NAME: "Northstar Work",
		DEFAULT_LOCALE: "en",
		INSTALLATION_ID: "10000000-0000-4000-8000-000000000001",
		OPENFGA_API_URL: "http://localhost:8080",
		AUTH_SECRET: "synthetic_template_secret_not_a_real_credential",
		SMTP_HOST: "localhost",
		SMTP_PORT: "1026",
		...presets[name as keyof typeof presets],
	};
	if (name !== "foundation")
		Object.assign(env, {
			FILES_S3_BUCKET: "synthetic-private",
			FILES_S3_UPLOAD_KEY: "synthetic-upload",
			FILES_S3_UPLOAD_SECRET: "synthetic-upload-secret",
			FILES_S3_FINALIZER_KEY: "synthetic-finalize",
			FILES_S3_FINALIZER_SECRET: "synthetic-finalize-secret",
			LIFECYCLE_DATABASE_URL:
				"postgres://saas_cook_lifecycle:synthetic@localhost/app",
			JOURNAL_DATABASE_URL:
				"postgres://saas_cook_journal_writer:synthetic@localhost/control",
		});
	if (name === "commercial-provider")
		Object.assign(env, {
			STRIPE_MODE: "test",
			STRIPE_SECRET_KEY: "sk_test_synthetic",
			STRIPE_ACCOUNT_ID: "acct_synthetic",
			STRIPE_WEBHOOK_SECRET: "whsec_synthetic",
			STRIPE_PORTAL_CONFIGURATION_ID: "bpc_synthetic",
			POSTHOG_PROJECT_ID: "123",
			POSTHOG_TOKEN: "synthetic_posthog_token",
			POSTHOG_PERSONAL_KEY: "synthetic_posthog_personal_key",
		});
	return env;
}

/**
 * Bind retained independent agent evidence to current skill bytes and reference deltas.
 * @param root - Repository containing committed historical evidence and current skills.
 * @returns Measured hashes, changed references and explicit limits; never claims fresh agent execution.
 * Missing evidence or changed canonical skills fail, requiring a new applicability review.
 */
export async function auditTemplateSkillEvidence(root: string) {
	const read = async (name: string) =>
		JSON.parse(await readFile(join(root, name), "utf8"));
	const foundation = await read("docs/phase4/evidence/release.json");
	const commercial = await read("docs/phase5/evaluation-2026-10-19.json");
	const platform = await read(
		"docs/phase6/evidence/acceptance-2026-10-21.json",
	);
	const skillHashes = await templateHashes(
		root,
		Object.keys(commercial.skillHashes),
	);
	for (const [name, digest] of Object.entries(skillHashes)) {
		if (reviewedSkillHashes[name] !== digest)
			throw new Error(
				"Canonical skill changed: fresh applicability review required",
			);
	}
	const referenceHashes = await templateHashes(
		root,
		Object.keys(platform.contractSha256),
	);
	return {
		mode: "retained-independent-evidence-with-explicit-delta-review",
		freshAgentTrials: 0,
		skillHashes,
		historicalFoundationSkillDifferences: Object.keys(skillHashes).filter(
			(name) => foundation.skillHashes[name] !== skillHashes[name],
		),
		phase5SkillsIdentical: Object.entries(skillHashes).every(
			([name, digest]) => commercial.skillHashes[name] === digest,
		),
		changedPhase5Skills: Object.keys(skillHashes).filter(
			(name) => commercial.skillHashes[name] !== skillHashes[name],
		),
		reviewedSkillHashes,
		phase6ReferenceHashes: referenceHashes,
		changedPhase6References: Object.keys(referenceHashes).filter(
			(name) => platform.contractSha256[name] !== referenceHashes[name],
		),
		evidenceRecords: await templateHashes(root, [
			"docs/phase4/evidence/release.json",
			"docs/phase5/evaluation-2026-10-19.json",
			"docs/phase6/evidence/acceptance-2026-10-21.json",
		]),
		review: "docs/phase8/template.md",
		limitations: [
			"Historical trials retain their recorded source and task scope",
			"Deterministic checks do not evaluate agent authoring behavior",
			"New authoring semantics or changed canonical skills require review and applicable new trials",
		],
	};
}

/**
 * Start the renamed production standalone bundle and verify both localized public pages.
 * @param candidate - Built disposable source copy; the configured databases are never contacted by public pages.
 * @param log - Attempt-owned output file for bounded child-process diagnostics.
 * @returns Verified locales and runtime brand; throws on startup, HTTP or branding failure.
 * Terminates only its own child process, including failures; no ambient services are touched.
 */
export async function verifyRenamedTemplateServer(
	candidate: string,
	log: string,
) {
	const listener = createServer();
	await new Promise<void>((resolve, reject) => {
		listener.once("error", reject);
		listener.listen(0, "127.0.0.1", resolve);
	});
	const address = listener.address();
	assert.ok(address && typeof address !== "string");
	const port = address.port;
	await new Promise<void>((resolve, reject) =>
		listener.close((error) => (error ? reject(error) : resolve())),
	);
	const brand = "Northstar Runtime Product";
	const child = spawn(
		process.execPath,
		["apps/web/.next/standalone/apps/web/server.js"],
		{
			cwd: candidate,
			env: {
				PATH: process.env.PATH,
				HOME: process.env.HOME,
				NODE_ENV: "production",
				...templatePresetEnvironment("foundation"),
				APP_NAME: brand,
				HOSTNAME: "127.0.0.1",
				PORT: String(port),
			},
			stdio: ["ignore", "pipe", "pipe"],
		},
	);
	let output = "";
	child.stdout.on("data", (data) => {
		output = (output + String(data)).slice(-128_000);
	});
	child.stderr.on("data", (data) => {
		output = (output + String(data)).slice(-128_000);
	});
	const exited = new Promise<void>((resolve) =>
		child.once("exit", () => resolve()),
	);
	try {
		let ready = false;
		for (let attempt = 0; attempt < 120; attempt++) {
			if (child.exitCode !== null)
				throw new Error("Renamed standalone server exited before readiness");
			try {
				const response = await fetch(`http://127.0.0.1:${port}/en/about`, {
					signal: AbortSignal.timeout(1000),
				});
				if (response.ok) {
					ready = true;
					break;
				}
			} catch {
				/* Startup is bounded and retried. */
			}
			await delay(250);
		}
		assert.ok(ready, "Renamed standalone server did not become ready");
		for (const locale of ["en", "es"]) {
			const response = await fetch(`http://127.0.0.1:${port}/${locale}/about`, {
				signal: AbortSignal.timeout(10_000),
			});
			assert.equal(response.status, 200);
			const html = await response.text();
			assert.ok(html.includes(`lang="${locale}"`));
			assert.ok(html.includes(`<h1>${brand}</h1>`));
			assert.ok(!html.includes("SaaS Cook"));
		}
		return { locales: ["en", "es"], appName: brand };
	} finally {
		child.kill("SIGTERM");
		await Promise.race([exited, delay(3000)]);
		if (child.exitCode === null && child.signalCode === null) {
			child.kill("SIGKILL");
			await exited;
		}
		await writeFile(log, output);
	}
}

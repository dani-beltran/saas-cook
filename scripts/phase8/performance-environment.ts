import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { z } from "zod";

const port = z.number().int().min(1024).max(65535);
const profileSchema = z
	.strictObject({
		version: z.literal(1),
		id: z.string().regex(/^[a-f0-9]{32}$/),
		ports: z.strictObject({
			postgres: port,
			control: port,
			openfga: port,
			storage: port,
			mailpit: port,
		}),
	})
	.refine(
		({ ports }) =>
			new Set(Object.values(ports)).size === 5 &&
			!Object.values(ports).some((value) =>
				[55433, 55434, 18081, 19000, 8026, 1026].includes(value),
			),
		"Dedicated ports must be unique and cannot select shared services",
	);
export type PerformanceEnvironment = z.infer<typeof profileSchema>;

/** Read the wrapper's exact disposable profile; missing/malformed/shared endpoints fail closed. */
export function performanceEnvironment(
	raw = process.env.PHASE8_BENCHMARK_ENVIRONMENT,
) {
	if (!raw)
		throw new Error(
			"Use phase8:performance or phase8:performance:smoke to provision isolated services",
		);
	try {
		return profileSchema.parse(JSON.parse(raw));
	} catch {
		throw new Error("Invalid isolated benchmark environment profile");
	}
}
/** Derive project-owned paths and network from a validated attempt identifier, never caller names. */
export function performanceEnvironmentNames(profile: PerformanceEnvironment) {
	const { id } = profileSchema.parse(profile);
	return {
		project: `phase8-perf-${id}`,
		network: `phase8-perf-${id}_default`,
		directory: `artifacts/phase8/performance-environments/${id}`,
	};
}
/** Return exact Compose arguments targeting only this benchmark project and its dedicated file. */
export function performanceComposeArgs(profile: PerformanceEnvironment) {
	return [
		"compose",
		"--project-name",
		performanceEnvironmentNames(profile).project,
		"--file",
		"infra/phase8/compose.performance.yaml",
	];
}
/** Build synthetic loopback fixture URLs; credentials are fixed disposable defaults, never ambient. */
export function performanceFixtureEnvironment(profile: PerformanceEnvironment) {
	const { ports } = profileSchema.parse(profile);
	return {
		TEST_DATABASE_ADMIN_URL: `postgres://postgres:local_phase1@127.0.0.1:${ports.postgres}/postgres`,
		TEST_CONTROL_ADMIN_URL: `postgres://postgres:local_phase2_control@127.0.0.1:${ports.control}/postgres`,
		OPENFGA_API_URL: `http://127.0.0.1:${ports.openfga}`,
		S3_ENDPOINT: `http://127.0.0.1:${ports.storage}`,
		MAILPIT_HTTP_URL: `http://127.0.0.1:${ports.mailpit}`,
	};
}
/** Parse Docker's explicitly loopback-bound dynamic published port; other addresses fail closed. */
export function performancePublishedPort(value: string) {
	const match = /^127\.0\.0\.1:(\d+)\s*$/.exec(value);
	if (!match)
		throw new Error("Benchmark service must publish only on loopback");
	return port.parse(Number(match[1]));
}
/** Parse a POSIX df -Pk observation into bytes; malformed/missing capacity must stop the workload. */
export function performanceStorageSample(value: string) {
	const fields = value.trim().split("\n").at(-1)?.trim().split(/\s+/) ?? [];
	const totalBytes = Number(fields[1]) * 1024,
		availableBytes = Number(fields[3]) * 1024;
	if (
		fields.length !== 6 ||
		![totalBytes, availableBytes].every(Number.isSafeInteger) ||
		totalBytes <= 0 ||
		availableBytes < 0 ||
		availableBytes > totalBytes
	)
		throw new Error("Invalid benchmark storage capacity observation");
	return { filesystem: fields[0], totalBytes, availableBytes };
}
/** Require 8 GiB free before seeding and a 1 GiB reserve during load; this never expands a volume. */
export function performanceStorageSafe(
	availableBytes: number,
	phase: "preflight" | "measurement",
) {
	return (
		Number.isSafeInteger(availableBytes) &&
		availableBytes >= (phase === "preflight" ? 8 : 1) * 1024 ** 3
	);
}

/**
 * Ask the owning wrapper to collect final diagnostics and remove only its private services/volumes.
 * @returns Cleanup success and immutable evidence paths; timeout/disconnect returns failed evidence.
 * Must run after image/bucket/database cleanup and before the final workload receipt is written.
 */
export async function finalizePerformanceEnvironment(): Promise<{
	passed: boolean;
	artifactPaths: string[];
}> {
	let profile: PerformanceEnvironment;
	try {
		profile = performanceEnvironment();
	} catch {
		return { passed: false, artifactPaths: [] };
	}
	const { directory } = performanceEnvironmentNames(profile);
	const failed = async () => {
		await mkdir(directory, { recursive: true });
		const path = `${directory}/cleanup-unconfirmed-${randomUUID()}.json`;
		await writeFile(
			path,
			JSON.stringify({
				status: "failed",
				reason: "Owning wrapper cleanup was not confirmed",
			}),
			{ flag: "wx" },
		);
		return { passed: false, artifactPaths: [path] };
	};
	if (!process.send || !process.connected) return failed();
	const result = await new Promise<boolean | undefined>((resolve) => {
		const finish = (passed?: boolean) => {
			clearTimeout(timer);
			process.off("message", receive);
			process.off("disconnect", disconnect);
			resolve(passed);
		};
		const receive = (message: unknown) => {
			const parsed = z
				.strictObject({
					type: z.literal("phase8.environment-cleanup"),
					id: z.literal(profile.id),
					passed: z.boolean(),
				})
				.safeParse(message);
			if (parsed.success) finish(parsed.data.passed);
		};
		const disconnect = () => finish();
		const timer = setTimeout(() => finish(), 90000);
		process.on("message", receive);
		process.once("disconnect", disconnect);
		process.send?.(
			{ type: "phase8.environment-cleanup-request", id: profile.id },
			undefined,
			undefined,
			(error: Error | null) => {
				if (error) finish();
			},
		);
	});
	if (result === undefined) return failed();
	return {
		passed: result,
		artifactPaths: [
			`${directory}/preflight.json`,
			`${directory}/cleanup.json`,
			`${directory}/workload.log`,
		],
	};
}

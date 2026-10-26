import { Writable } from "node:stream";
import { describe, expect, it, vi } from "vitest";
import { createTestFileStorage } from "../../packages/testing/src/file-storage";
import {
	performanceEnvironment,
	performanceEnvironmentNames,
	performanceFixtureEnvironment,
	performancePublishedPort,
	performanceStorageSafe,
	performanceStorageSample,
} from "./performance-environment";
import { performanceLog } from "./performance-log";
import { performanceServices } from "./performance-services";

const id = "a".repeat(32),
	project = `phase8-perf-${id}`;
const raw = {
	version: 1,
	id,
	ports: {
		postgres: 31001,
		control: 31002,
		openfga: 31003,
		storage: 31004,
		mailpit: 31005,
	},
};
const df = (freeGiB = 12) =>
	`Filesystem 1024-blocks Used Available Capacity Mounted on\n/dev/disk 20971520 100000 ${freeGiB * 1024 ** 2} 10% /phase8-data\n`;

describe("explicit isolated benchmark profile", () => {
	it("derives only owned project names and synthetic fixture endpoints", () => {
		const profile = performanceEnvironment(JSON.stringify(raw));
		expect(performanceEnvironmentNames(profile).network).toBe(
			`${project}_default`,
		);
		expect(performanceFixtureEnvironment(profile).S3_ENDPOINT).toBe(
			"http://127.0.0.1:31004",
		);
		expect(
			performanceFixtureEnvironment(profile).TEST_DATABASE_ADMIN_URL,
		).toContain("127.0.0.1:31001");
	});
	it.each([
		{ ...raw, id: "saas-cook-phase1" },
		{ ...raw, network: "shared" },
		{ ...raw, ports: { ...raw.ports, postgres: 55433 } },
		{ ...raw, ports: { ...raw.ports, postgres: 31002 } },
	])("rejects ambiguous/shared configuration %j", (value) => {
		expect(() => performanceEnvironment(JSON.stringify(value))).toThrow();
	});
	it.each([
		"0.0.0.0:31001",
		"[::]:31001",
		"127.0.0.1:80",
		"127.0.0.1:31001\n127.0.0.1:31002",
	])("rejects nonprivate or ambiguous port %s", (value) => {
		expect(() => performancePublishedPort(value)).toThrow();
	});
	it("keeps the preflight and emergency reserve distinct and rejects missing capacity", () => {
		expect(performanceStorageSample(df()).availableBytes).toBe(12 * 1024 ** 3);
		expect(performanceStorageSafe(8 * 1024 ** 3, "preflight")).toBe(true);
		expect(performanceStorageSafe(7 * 1024 ** 3, "preflight")).toBe(false);
		expect(performanceStorageSafe(1024 ** 3 - 1, "measurement")).toBe(false);
		expect(performanceStorageSafe(Number.NaN, "measurement")).toBe(false);
		expect(() => performanceStorageSample("Filesystem unavailable")).toThrow();
	});
	it.each([
		"https://127.0.0.1:31004",
		"http://storage.example:31004",
		"http://secret@localhost:31004",
		"http://localhost:31004/?credential=x",
	])(
		"rejects external/credential storage before any network I/O %s",
		async (endpoint) => {
			await expect(
				createTestFileStorage("http://localhost:3000", endpoint),
			).rejects.toThrow("explicit local");
		},
	);
});

function fakeDocker(
	options: {
		preexisting?: "container" | "volume" | "network" | "foreign-volume";
		freeGiB?: number;
		tmpfs?: boolean;
		failedSetup?: boolean;
		failedDown?: boolean;
	} = {},
) {
	let created = false;
	const calls: string[][] = [];
	const names = [
		"postgres",
		"control-postgres",
		"openfga",
		"storage",
		"mailpit",
	];
	const docker = async (args: string[]) => {
		calls.push(args);
		if (args[0] === "ps") {
			if (args.at(-1)?.startsWith("label=dev.saas-cook")) return "";
			return created
				? names.join("\n")
				: options.preexisting === "container"
					? "existing"
					: "";
		}
		if (args[0] === "volume" && args[1] === "ls" && args.includes("--format"))
			return options.preexisting === "foreign-volume"
				? `${project}_application-data`
				: "";
		if (args[0] === "volume" && args[1] === "ls")
			return created
				? `${project}_application-data`
				: options.preexisting === "volume"
					? "existing"
					: "";
		if (args[0] === "network")
			return created || options.preexisting === "network" ? "network-id" : "";
		if (args[0] === "compose") {
			expect(args.slice(0, 5)).toEqual([
				"compose",
				"--project-name",
				project,
				"--file",
				"infra/phase8/compose.performance.yaml",
			]);
			if (args.includes("up")) {
				created = true;
				if (options.failedSetup) throw new Error("partial setup");
				return "";
			}
			if (args.includes("down")) {
				if (options.failedDown) throw new Error("down failed");
				created = false;
				return "";
			}
			if (args.includes("port"))
				return `127.0.0.1:${31001 + names.indexOf(args.at(-2) ?? "")}`;
		}
		if (args[0] === "inspect") {
			const service = args[1];
			const volume =
				service === "postgres"
					? "application-data"
					: service === "control-postgres"
						? "control-data"
						: "object-data";
			return JSON.stringify([
				{
					Id: service,
					Image: "sha256:synthetic",
					Config: {
						Image: "pinned",
						Labels: {
							"com.docker.compose.project": project,
							"com.docker.compose.service": service,
						},
					},
					Mounts: [
						{
							Type: options.tmpfs ? "tmpfs" : "volume",
							Name: `${project}_${volume}`,
							Destination:
								service === "storage" ? "/data" : "/var/lib/postgresql",
						},
					],
					HostConfig: {},
				},
			]);
		}
		if (args[0] === "volume" && args[1] === "inspect")
			return JSON.stringify([
				{
					Name: args[2],
					Driver: "local",
					Options: null,
					Labels: { "com.docker.compose.project": project },
					Mountpoint: "/owned/data",
				},
			]);
		if (args[0] === "run") return df(options.freeGiB);
		throw new Error(`Unexpected fake command: ${args.join(" ")}`);
	};
	return { docker, calls };
}
describe("owned service lifecycle", () => {
	it("provisions all private endpoints and tears down only the exact generated project", async () => {
		const fake = fakeDocker();
		const service = performanceServices(id, fake.docker);
		const ready = await service.setup();
		expect(ready.profile.ports).toEqual(raw.ports);
		expect(ready.storage.volumes).toHaveLength(3);
		expect((await service.cleanup()).passed).toBe(true);
		expect(fake.calls.filter((args) => args.includes("down"))).toHaveLength(1);
		expect(
			fake.calls.some((args) => args.join(" ").includes("saas-cook-phase1")),
		).toBe(false);
	});
	it.each(["container", "volume", "network", "foreign-volume"] as const)(
		"refuses to adopt or clean a preexisting %s",
		async (preexisting) => {
			const fake = fakeDocker({ preexisting });
			const service = performanceServices(id, fake.docker);
			await expect(service.setup()).rejects.toThrow("existing");
			expect(await service.cleanup()).toMatchObject({
				passed: true,
				owned: false,
			});
			expect(
				fake.calls.some((args) => args.includes("down") || args.includes("up")),
			).toBe(false);
		},
	);
	it.each([{ freeGiB: 7 }, { tmpfs: true }, { failedSetup: true }])(
		"cleans only owned resources after rejected partial setup %j",
		async (options) => {
			const fake = fakeDocker(options);
			const service = performanceServices(id, fake.docker);
			await expect(service.setup()).rejects.toThrow();
			expect((await service.cleanup()).passed).toBe(true);
		},
	);
	it("reports failed teardown and remaining owned resources without broadening deletion", async () => {
		const fake = fakeDocker({ failedDown: true });
		const service = performanceServices(id, fake.docker);
		await service.setup();
		expect(await service.cleanup()).toMatchObject({
			passed: false,
			failures: [
				"compose-cleanup",
				"remaining-container",
				"remaining-volume",
				"remaining-network",
			],
		});
	});
	it("stops scheduling cleanup commands once the total budget has expired", async () => {
		const fake = fakeDocker();
		const service = performanceServices(id, fake.docker);
		await service.setup();
		const now = vi
			.spyOn(Date, "now")
			.mockReturnValueOnce(0)
			.mockReturnValue(46000);
		try {
			expect((await service.cleanup()).passed).toBe(false);
		} finally {
			now.mockRestore();
		}
	});
});
describe("workload log write failures", () => {
	it("marks the run failed without an unhandled stream error or rejecting cleanup flush", async () => {
		const failed = vi.fn();
		const log = performanceLog(
			"unused",
			failed,
			() =>
				new Writable({
					write(_chunk, _encoding, callback) {
						callback(new Error("ENOSPC"));
					},
				}),
		);
		log.write(Buffer.from("synthetic report"));
		expect(await log.finish()).toBe(false);
		expect(failed).toHaveBeenCalledOnce();
	});
});

it("bounds a stalled log flush and ignores output after finalization", async () => {
	vi.useFakeTimers();
	try {
		const failed = vi.fn(),
			writes = vi.fn();
		const log = performanceLog(
			"unused",
			failed,
			() =>
				new Writable({
					write(_chunk, _encoding, callback) {
						writes();
						callback();
					},
					final() {},
				}),
		);
		log.write(Buffer.from("before"));
		const first = log.finish();
		expect(log.finish()).toBe(first);
		log.write(Buffer.from("after"));
		await vi.advanceTimersByTimeAsync(5000);
		expect(await first).toBe(false);
		expect(writes).toHaveBeenCalledOnce();
		expect(failed).toHaveBeenCalledOnce();
	} finally {
		vi.useRealTimers();
	}
});

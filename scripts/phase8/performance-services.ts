import assert from "node:assert/strict";
import {
	performanceComposeArgs,
	performanceEnvironment,
	performanceEnvironmentNames,
	performancePublishedPort,
	performanceStorageSafe,
	performanceStorageSample,
} from "./performance-environment";

type Docker = (args: string[], timeoutMs?: number) => Promise<string>;
const volumes = ["application-data", "control-data", "object-data"];

/**
 * Create a lifecycle controller for one new benchmark project; no Docker operation occurs yet.
 * @param id Fresh 32-hex attempt ID; existing resources with that project label are rejected.
 * @param docker Bounded Docker command adapter, injectable for ownership and failure tests.
 * @returns Setup/sample/cleanup operations. Cleanup only addresses resources owned by this ID.
 * The caller must invoke cleanup in finally, including after a partial setup failure.
 */
export function performanceServices(id: string, docker: Docker) {
	let profile = performanceEnvironment(
		JSON.stringify({
			version: 1,
			id,
			ports: {
				postgres: 31001,
				control: 31002,
				openfga: 31003,
				storage: 31004,
				mailpit: 31005,
			},
		}),
	);
	const names = performanceEnvironmentNames(profile);
	const compose = performanceComposeArgs(profile);
	let owned = false;
	let postgresImage = "";
	let containers: Array<Record<string, unknown>> = [];
	const ids = (value: string) => value.trim().split(/\s+/).filter(Boolean);
	function boundedDocker(budgetMs: number): Docker {
		const deadline = Date.now() + budgetMs;
		return (args, timeoutMs = 20000) => {
			const remaining = deadline - Date.now();
			if (remaining <= 0)
				throw new Error("Owned benchmark operation deadline exceeded");
			return docker(args, Math.min(timeoutMs, remaining));
		};
	}
	async function inventory(kind: "container" | "volume", run = docker) {
		return ids(
			await run(
				kind === "container"
					? [
							"ps",
							"--all",
							"--quiet",
							"--filter",
							`label=com.docker.compose.project=${names.project}`,
						]
					: [
							"volume",
							"ls",
							"--quiet",
							"--filter",
							`label=com.docker.compose.project=${names.project}`,
						],
			),
		);
	}
	async function sample() {
		const observe = boundedDocker(15000);
		assert(
			owned && postgresImage,
			"Storage sampling requires this attempt's inspected services",
		);
		const observations = [];
		for (const volume of volumes) {
			const name = `${names.project}_${volume}`;
			const [metadata] = JSON.parse(await observe(["volume", "inspect", name]));
			assert.equal(metadata.Name, name);
			assert.equal(metadata.Driver, "local");
			assert.equal(
				metadata.Labels?.["com.docker.compose.project"],
				names.project,
			);
			assert(
				!metadata.Options || Object.keys(metadata.Options).length === 0,
				"Benchmark volumes must use ordinary local disk, never tmpfs driver options",
			);
			const observed = performanceStorageSample(
				await observe([
					"run",
					"--rm",
					"--network",
					"none",
					"--label",
					`dev.saas-cook.phase8.probe=${names.project}`,
					"--mount",
					`type=volume,src=${name},dst=/phase8-data,readonly`,
					"--entrypoint",
					"df",
					postgresImage,
					"-Pk",
					"/phase8-data",
				]),
			);
			observations.push({
				volume: name,
				driver: metadata.Driver,
				mountpoint: metadata.Mountpoint,
				...observed,
			});
		}
		return { observedAt: new Date().toISOString(), volumes: observations };
	}
	async function setup() {
		assert.equal(
			(await inventory("container")).length,
			0,
			"Refusing an existing benchmark project",
		);
		assert.equal(
			(await inventory("volume")).length,
			0,
			"Refusing existing benchmark volumes",
		);
		for (const volume of volumes) {
			const name = `${names.project}_${volume}`;
			const found = ids(
				await docker([
					"volume",
					"ls",
					"--format",
					"{{.Name}}",
					"--filter",
					`name=${name}`,
				]),
			);
			assert(
				!found.includes(name),
				"Refusing an existing named benchmark volume regardless of owner label",
			);
		}
		assert.equal(
			(
				await docker([
					"network",
					"ls",
					"--quiet",
					"--filter",
					`name=^${names.network}$`,
				])
			).trim(),
			"",
			"Refusing an existing benchmark network",
		);
		owned = true;
		await docker(
			[...compose, "up", "--detach", "--wait", "--wait-timeout", "90"],
			120000,
		);
		const ports = { ...profile.ports };
		for (const [key, service, port] of [
			["postgres", "postgres", 5432],
			["control", "control-postgres", 5432],
			["openfga", "openfga", 8080],
			["storage", "storage", 8333],
			["mailpit", "mailpit", 8025],
		] as const)
			ports[key] = performancePublishedPort(
				await docker([...compose, "port", service, String(port)]),
			);
		profile = performanceEnvironment(JSON.stringify({ version: 1, id, ports }));
		containers = [];
		for (const container of await inventory("container")) {
			const [row] = JSON.parse(await docker(["inspect", container]));
			assert.equal(
				row.Config.Labels?.["com.docker.compose.project"],
				names.project,
			);
			const service = row.Config.Labels?.["com.docker.compose.service"];
			if (service === "postgres") postgresImage = row.Image;
			if (["postgres", "control-postgres", "storage"].includes(service)) {
				const destination =
					service === "storage" ? "/data" : "/var/lib/postgresql";
				const mount = row.Mounts.find(
					(mount: { Destination: string }) => mount.Destination === destination,
				);
				assert(
					mount?.Type === "volume" &&
						mount.Name.startsWith(`${names.project}_`),
					"Benchmark data must use this project's disk volume",
				);
			}
			containers.push({
				id: row.Id,
				service,
				image: row.Image,
				imageReference: row.Config.Image,
				mounts: row.Mounts.map(
					({
						Type,
						Name,
						Destination,
					}: {
						Type: string;
						Name?: string;
						Destination: string;
					}) => ({ type: Type, name: Name, destination: Destination }),
				),
				limits: {
					memoryBytes: row.HostConfig.Memory,
					nanoCpus: row.HostConfig.NanoCpus,
					cpuQuota: row.HostConfig.CpuQuota,
					cpuPeriod: row.HostConfig.CpuPeriod,
				},
			});
		}
		const storage = await sample();
		assert(
			storage.volumes.every(({ availableBytes }) =>
				performanceStorageSafe(availableBytes, "preflight"),
			),
			"Benchmark requires at least 8 GiB free on every Docker data filesystem before seeding",
		);
		return {
			profile,
			...names,
			containers,
			storage,
			preflightMinimumBytes: 8 * 1024 ** 3,
			measurementReserveBytes: 1024 ** 3,
			storageMode: "project-owned local disk volumes; no database tmpfs",
		};
	}
	async function cleanup() {
		if (!owned) return { passed: true, owned: false, failures: [] };
		const failures: string[] = [];
		const remove = boundedDocker(45000);
		for (const role of ["image", "probe"]) {
			try {
				for (const container of ids(
					await remove([
						"ps",
						"--all",
						"--quiet",
						"--filter",
						`label=dev.saas-cook.phase8.${role}=${names.project}`,
					]),
				)) {
					const [row] = JSON.parse(await remove(["inspect", container]));
					assert.equal(
						row.Config.Labels?.[`dev.saas-cook.phase8.${role}`],
						names.project,
					);
					await remove(["rm", "--force", container]);
				}
			} catch {
				failures.push(`${role}-cleanup`);
			}
		}
		try {
			await remove(
				[
					...compose,
					"down",
					"--volumes",
					"--remove-orphans",
					"--timeout",
					"15",
				],
				60000,
			);
		} catch {
			failures.push("compose-cleanup");
		}
		for (const kind of ["container", "volume"] as const) {
			try {
				if ((await inventory(kind, remove)).length)
					failures.push(`remaining-${kind}`);
			} catch {
				failures.push(`${kind}-inspection`);
			}
		}
		try {
			if (
				(
					await remove([
						"network",
						"ls",
						"--quiet",
						"--filter",
						`name=^${names.network}$`,
					])
				).trim()
			)
				failures.push("remaining-network");
		} catch {
			failures.push("network-inspection");
		}
		return { passed: failures.length === 0, owned: true, failures };
	}
	return { names, setup, sample, cleanup };
}

import { describe, expect, it } from "vitest";
import { performanceContainerUrl } from "./performance-image";

const profile = {
	version: 1 as const,
	id: "a".repeat(32),
	ports: {
		postgres: 31001,
		control: 31002,
		openfga: 31003,
		storage: 31004,
		mailpit: 31005,
	},
};
describe("performance image Compose connectivity", () => {
	it.each([
		[
			"postgres://synthetic:secret@127.0.0.1:31001/isolated_db?sslmode=disable",
			"postgres",
			"5432",
		],
		[
			"postgresql://synthetic:secret@localhost:31002/isolated_db?sslmode=disable",
			"control-postgres",
			"5432",
		],
	])(
		"maps %s while preserving the restricted fixture identity and query",
		(value, host, port) => {
			const before = new URL(value);
			const after = new URL(performanceContainerUrl(value, profile));
			expect(after.hostname).toBe(host);
			expect(after.port).toBe(port);
			for (const field of [
				"protocol",
				"username",
				"password",
				"pathname",
				"search",
			] as const)
				expect(after[field]).toBe(before[field]);
		},
	);
	it.each([
		["http://127.0.0.1:31003", "http://openfga:8080"],
		["http://localhost:31004", "http://storage:8333"],
		[
			"http://127.0.0.1:31004/path?mode=synthetic",
			"http://storage:8333/path?mode=synthetic",
		],
	])("maps only the published local service endpoint %s", (value, expected) => {
		expect(performanceContainerUrl(value, profile)).toBe(expected);
	});
	it.each([
		"postgres://synthetic:secret@fixture.example.test:31001/database",
		"http://fixture.example.test:31003/",
		"http://127.0.0.1:19999/",
		"https://localhost:31004/",
		"http://localhost:31001/",
		"postgres://synthetic:secret@127.0.0.2:31001/database",
	])(
		"preserves external, unknown local and mismatched protocol URL %s",
		(value) => {
			expect(performanceContainerUrl(value, profile)).toBe(value);
		},
	);
});

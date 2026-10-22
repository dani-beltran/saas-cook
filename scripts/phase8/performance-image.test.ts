import { describe, expect, it } from "vitest";
import { performanceContainerUrl } from "./performance-image";

describe("performance image Compose connectivity", () => {
	it.each([
		[
			"postgres://synthetic:secret@127.0.0.1:55433/isolated_db?sslmode=disable",
			"postgres",
			"5432",
		],
		[
			"postgresql://synthetic:secret@localhost:55434/isolated_db?sslmode=disable",
			"control-postgres",
			"5432",
		],
	])(
		"maps %s while preserving the restricted fixture identity and query",
		(value, host, port) => {
			const before = new URL(value);
			const after = new URL(performanceContainerUrl(value));
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
		["http://127.0.0.1:18081", "http://openfga:8080"],
		["http://localhost:19000", "http://storage:8333"],
		[
			"http://127.0.0.1:19000/path?mode=synthetic",
			"http://storage:8333/path?mode=synthetic",
		],
	])("maps only the published local service endpoint %s", (value, expected) => {
		expect(performanceContainerUrl(value)).toBe(expected);
	});
	it.each([
		"postgres://synthetic:secret@fixture.example.test:55433/database",
		"http://fixture.example.test:18081/",
		"http://127.0.0.1:19999/",
		"https://localhost:19000/",
		"http://localhost:55433/",
		"postgres://synthetic:secret@127.0.0.2:55433/database",
	])(
		"preserves external, unknown local and mismatched protocol URL %s",
		(value) => {
			expect(performanceContainerUrl(value)).toBe(value);
		},
	);
});

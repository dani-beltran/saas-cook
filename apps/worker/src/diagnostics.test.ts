import { expect, it } from "vitest";
import { workerFailureStatus } from "./diagnostics";

it("reports database setup failures without copying sensitive driver details", () => {
	const error = Object.assign(new Error("database sensitive-name is missing"), {
		code: "3D000",
		detail: "postgres://user:secret@localhost/sensitive-name",
	});
	expect(workerFailureStatus(error)).toBe("database_missing");
	expect(workerFailureStatus({ ...error, code: "42P01" })).toBe(
		"schema_missing",
	);
});

it("never passes through unknown codes, error messages or thrown payloads", () => {
	for (const error of [
		Object.assign(new Error("https://app.test/magic?token=secret"), {
			code: "sensitive_value",
		}),
		{ code: "constructor" },
		{ code: "__proto__" },
		"secret",
		null,
		undefined,
	]) {
		expect(workerFailureStatus(error)).toBe("unknown");
	}
});

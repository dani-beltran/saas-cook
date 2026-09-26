import assert from "node:assert/strict";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";

type CaseIdentity = { file: string; name: string };
type CaseResult = CaseIdentity & { status: string };

/** Keep a multiset: unnamed parameterized cases may share a title. */
function verifyRequiredCases(actual: CaseResult[], required: CaseIdentity[]) {
	assert.ok(required.length, "The frozen required case set must not be empty");
	assert.ok(actual.length, "The suite must execute cases");
	const counts = new Map<string, number>();
	for (const entry of actual) {
		assert.equal(
			entry.status,
			"passed",
			`Case did not pass: ${entry.file}: ${entry.name}`,
		);
		const key = JSON.stringify([entry.file, entry.name]);
		counts.set(key, (counts.get(key) ?? 0) + 1);
	}
	for (const entry of required) {
		const key = JSON.stringify([entry.file, entry.name]);
		const count = counts.get(key) ?? 0;
		assert.ok(count > 0, `Required case missing: ${entry.file}: ${entry.name}`);
		counts.set(key, count - 1);
	}
	return actual;
}

/** Each invocation uses a new path; an old successful report is never evidence. */
export async function readFreshReport(file: string, startedAt: number) {
	const metadata = await stat(file);
	assert.ok(
		metadata.isFile() && metadata.size > 0,
		"Missing structured report",
	);
	assert.ok(metadata.mtimeMs >= startedAt - 1_000, "Stale structured report");
	return JSON.parse(await readFile(file, "utf8")) as unknown;
}

export function verifyVitestReport(
	value: unknown,
	root: string,
	required: CaseIdentity[],
	selectedNamePrefix?: string,
) {
	const report = value as {
		success: boolean;
		numFailedTestSuites: number;
		numFailedTests: number;
		numPendingTestSuites: number;
		numPendingTests: number;
		numTodoTests: number;
		numTotalTests: number;
		testResults: {
			name: string;
			assertionResults: { fullName: string; status: string }[];
		}[];
	};
	assert.equal(report.success, true, "Vitest did not succeed");
	assert.equal(report.numFailedTestSuites, 0, "Vitest suite failure");
	assert.equal(report.numFailedTests, 0, "Vitest case failure");
	if (!selectedNamePrefix) {
		assert.equal(report.numPendingTestSuites, 0, "Skipped Vitest suite");
		assert.equal(report.numPendingTests, 0, "Skipped Vitest case");
		assert.equal(report.numTodoTests, 0, "Unimplemented Vitest case");
	}
	assert.ok(Array.isArray(report.testResults), "Missing Vitest suites");
	const all = report.testResults.flatMap((suite) => {
		assert.equal(typeof suite.name, "string", "Missing suite identity");
		assert.ok(Array.isArray(suite.assertionResults), "Missing case results");
		return suite.assertionResults.map((test) => {
			assert.equal(typeof test.fullName, "string", "Missing case identity");
			return {
				file: path.relative(root, suite.name).split(path.sep).join("/"),
				name: test.fullName,
				status: test.status,
			};
		});
	});
	assert.equal(all.length, report.numTotalTests, "Vitest case count mismatch");
	return verifyRequiredCases(
		selectedNamePrefix
			? all.filter((entry) => entry.name.startsWith(selectedNamePrefix))
			: all,
		required,
	);
}

type BrowserSuite = {
	title: string;
	file?: string;
	suites?: BrowserSuite[];
	specs?: {
		title: string;
		file: string;
		ok: boolean;
		tests: {
			expectedStatus: string;
			status: string;
			results: { status: string; errors: unknown[] }[];
		}[];
	}[];
};

export function verifyPlaywrightReport(
	value: unknown,
	root: string,
	required: CaseIdentity[],
) {
	const report = value as {
		config: { rootDir: string };
		errors: unknown[];
		suites: BrowserSuite[];
		stats: { unexpected: number; skipped: number; flaky: number };
	};
	assert.ok(Array.isArray(report.errors), "Missing Playwright error report");
	assert.equal(report.errors.length, 0, "Playwright setup or teardown failed");
	assert.equal(report.stats.unexpected, 0, "Playwright case failure");
	assert.equal(report.stats.skipped, 0, "Skipped Playwright case");
	assert.equal(report.stats.flaky, 0, "Retried Playwright case");
	assert.ok(Array.isArray(report.suites), "Missing Playwright suites");
	assert.equal(typeof report.config.rootDir, "string", "Missing browser root");
	const actual: CaseResult[] = [];
	function visit(suite: BrowserSuite, ancestors: string[], fileSuite: boolean) {
		const names = fileSuite ? ancestors : [...ancestors, suite.title];
		for (const spec of suite.specs ?? []) {
			assert.equal(spec.ok, true, "Playwright spec did not pass");
			assert.ok(spec.tests.length, "Playwright spec has no results");
			for (const test of spec.tests) {
				assert.equal(
					test.expectedStatus,
					"passed",
					"Expected-failure cases cannot satisfy acceptance",
				);
				assert.equal(test.status, "expected", "Playwright case did not pass");
				assert.equal(
					test.results.length,
					1,
					"Browser cases must run once without retry",
				);
				assert.equal(
					test.results[0].status,
					"passed",
					"Browser case did not pass",
				);
				assert.deepEqual(test.results[0].errors, [], "Browser case has errors");
				actual.push({
					file: path
						.relative(root, path.resolve(report.config.rootDir, spec.file))
						.split(path.sep)
						.join("/"),
					name: [...names, spec.title].join(" "),
					status: "passed",
				});
			}
		}
		for (const child of suite.suites ?? []) visit(child, names, false);
	}
	for (const suite of report.suites) visit(suite, [], true);
	return verifyRequiredCases(actual, required);
}

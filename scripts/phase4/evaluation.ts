import { execFile, spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import {
	copyFile,
	lstat,
	mkdir,
	readdir,
	readFile,
	stat,
	unlink,
	writeFile,
} from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { promisify } from "node:util";
import { z } from "zod";

const exec = promisify(execFile);
const taskIds = Array.from(
	{ length: 10 },
	(_, i) => `task-${String(i + 1).padStart(2, "0")}`,
);
const phase5TaskIds = Array.from(
	{ length: 5 },
	(_, i) => `phase5-task-${String(i + 1).padStart(2, "0")}`,
);
const phase5Requirements: Record<string, string[]> = {
	"phase5-task-01": ["R-SKILLS", "R-POLICY", "R-TENANCY"],
	"phase5-task-02": ["R-SKILLS", "R-POLICY", "R-AUTHZ"],
	"phase5-task-03": ["R-SKILLS", "R-SEATS", "R-LIFECYCLE"],
	"phase5-task-04": ["R-SKILLS", "R-EMAIL", "R-AUTHZ"],
	"phase5-task-05": ["R-SKILLS", "R-TENANCY", "R-AUTHZ", "R-POLICY"],
};
const requirements: Record<string, string[]> = {
	"task-01": ["R-SKILLS", "R-TENANCY", "R-AUTHZ", "R-POLICY"],
	"task-02": ["R-SKILLS", "R-TENANCY", "R-AUTHZ", "R-LIFECYCLE"],
	"task-03": ["R-SKILLS", "R-TENANCY", "R-AUTHZ", "R-KEYS"],
	"task-04": ["R-SKILLS", "R-AUTHZ", "R-LIFECYCLE"],
	"task-05": ["R-SKILLS", "R-TENANCY", "R-AUTHZ", "R-KEYS"],
	"task-06": ["R-SKILLS", "R-POLICY", "R-LIFECYCLE"],
	"task-07": ["R-SKILLS", "R-TENANCY", "R-AUTHZ"],
	"task-08": ["R-SKILLS"],
	"task-09": ["R-SKILLS", "R-EMAIL", "R-AUTHZ"],
	"task-10": ["R-SKILLS", "R-TENANCY", "R-AUTHZ"],
};
const checkSchema = z.object({
	id: z.string().regex(/^[a-z0-9-]+$/),
	argv: z.array(z.string().min(1)).min(1),
	caseIds: z.array(z.string().min(1)).min(1),
	timeoutMs: z.number().int().positive().max(3_600_000).default(300_000),
});
const applicationCheckSchema = checkSchema.omit({ caseIds: true }).extend({
	successPattern: z.string().min(1),
});
const evaluatorSchema = z.object({
	version: z.literal(1),
	phase: z.union([z.literal(4), z.literal(5)]).default(4),
	tasks: z
		.array(
			z.object({
				id: z.string().min(1),
				brief: z.string().min(1),
				checks: z.array(checkSchema).min(1),
			}),
		)
		.min(1),
	applicationChecks: z.array(applicationCheckSchema).min(1),
});
const agentSchema = z.object({
	kind: z.literal("ai-agent"),
	provider: z.string().min(1),
	model: z.string().min(1),
	configuration: z
		.record(z.string(), z.unknown())
		.refine((value) => Object.keys(value).length > 0),
	taskIds: z.array(z.string()).min(1),
	transcriptPath: z.string().min(1),
});
const caseReportSchema = z.object({
	taskId: z.string(),
	checkId: z.string(),
	cases: z.array(
		z.object({
			id: z.string(),
			status: z.enum(["passed", "failed", "skipped"]),
		}),
	),
});
type FileHashes = Record<string, string>;
type Evaluator = z.infer<typeof evaluatorSchema>;
type Check = z.infer<typeof checkSchema>;
type ApplicationCheck = z.infer<typeof applicationCheckSchema>;
type Manifest = {
	version: 1;
	createdAt: string;
	templateRoot: string;
	templateCommit: string;
	templateSourceHashes: FileHashes;
	skillHashes: FileHashes;
	referenceHashes: FileHashes;
	controlHashes: FileHashes;
	requirements: Record<string, string[]>;
	repeats: number;
};
type CheckResult = {
	passed: boolean;
	exitCode: number | null;
	timedOut: boolean;
	argv: string[];
	log: string;
	logHash: string;
	failure?: string;
};
type Run = {
	candidatePath?: string;
	agent?: Omit<z.infer<typeof agentSchema>, "transcriptPath"> & {
		transcript: string;
		transcriptHash: string;
		recordedAt: string;
	};
	sourceHashes?: FileHashes;
	diffHash?: string;
	checks: Record<string, CheckResult[]>;
	applicationChecks?: CheckResult[];
};
const hash = (data: string | Buffer) =>
	createHash("sha256").update(data).digest("hex");
const json = async (path: string) => JSON.parse(await readFile(path, "utf8"));
const save = async (path: string, value: unknown) =>
	writeFile(path, `${JSON.stringify(value, null, 2)}\n`);
const same = (left: unknown, right: unknown) =>
	JSON.stringify(left) === JSON.stringify(right);
function inside(root: string, path: string) {
	const part = relative(root, resolve(root, path));
	if (!part || part.startsWith(`..${sep}`) || part === ".." || isAbsolute(part))
		throw new Error(`Path must be inside ${root}: ${path}`);
	return resolve(root, path);
}
/** Fail closed for credential files and generated/dependency directories, even if tracked. */
function sourcePath(path: string) {
	return (
		!/(^|\/)(\.git|node_modules|artifacts|\.next|dist|coverage|storybook-static|\.turbo|\.ssh|\.aws|\.config|\.codex|\.docker|\.cache|test-results|playwright-report)(\/|$)/.test(
			path,
		) &&
		!/(^|\/)\.env(\.|$)/.test(
			path.replace(/(^|\/)\.env\.example$/, "$1example"),
		) &&
		!/(^|\/)(credentials?|secrets?|auth)\.(json|ya?ml|toml)$|\.(pem|key|p12|pfx|crt)$/i.test(
			path,
		) &&
		!/(^|\/)(\.npmrc|\.netrc|\.pypirc|\.git-credentials|\.DS_Store)$/.test(
			path,
		) &&
		!/^(scripts\/phase4\/|docs\/phase4\/|tests\/phase4\/|evaluations\/)/.test(
			path,
		) &&
		path !== "packages/testing/src/phase4.integration.test.ts" &&
		!/\.tsbuildinfo$|(^|\/)next-env\.d\.ts$/.test(path)
	);
}
async function files(root: string, sourceOnly = false): Promise<string[]> {
	const found: string[] = [];
	async function visit(directory: string) {
		for (const entry of await readdir(directory, { withFileTypes: true })) {
			const path = join(directory, entry.name);
			const name = relative(root, path).split(sep).join("/");
			if (sourceOnly && !sourcePath(name)) continue;
			if (entry.isSymbolicLink())
				throw new Error(`Unexpected symlink: ${path}`);
			if (entry.isDirectory()) await visit(path);
			else if (entry.isFile()) found.push(name);
		}
	}
	await visit(root);
	return found.sort();
}
async function hashes(root: string, names: string[]) {
	const result: FileHashes = {};
	for (const name of names.sort())
		result[name] = hash(await readFile(inside(root, name)));
	return result;
}
async function copy(root: string, target: string, names: string[]) {
	for (const name of names) {
		const source = inside(root, name);
		if (!(await lstat(source)).isFile())
			throw new Error(`Source must be a regular file: ${source}`);
		const destination = inside(target, name);
		await mkdir(dirname(destination), { recursive: true });
		await copyFile(source, destination);
	}
}
function unique(values: string[], label: string) {
	if (new Set(values).size !== values.length)
		throw new Error(`Duplicate ${label}`);
}
function validateEvaluator(value: unknown) {
	const evaluator = evaluatorSchema.parse(value);
	const expected = evaluator.phase === 5 ? phase5TaskIds : taskIds;
	if (
		!same(evaluator.tasks.map((task) => task.id).sort(), [...expected].sort())
	)
		throw new Error(
			`Phase ${evaluator.phase} requires its exact declared task set`,
		);
	unique(
		evaluator.tasks.map((task) => task.id),
		"task IDs",
	);
	for (const task of evaluator.tasks) {
		unique(
			task.checks.map((check) => check.id),
			"check IDs",
		);
		for (const check of task.checks) unique(check.caseIds, "case IDs");
	}
	unique(
		evaluator.applicationChecks.map((check) => check.id),
		"application check IDs",
	);
	return evaluator;
}
export async function prepareEvaluation(options: {
	template: string;
	output: string;
	evaluators: string;
	briefs: string;
	repeats: number;
	baseline?: string;
}) {
	const template = resolve(options.template);
	const output = resolve(options.output);
	if (options.repeats < 2 || !Number.isInteger(options.repeats))
		throw new Error("At least two independent repeats are required");
	try {
		await stat(output);
		throw new Error("Evaluation output must not already exist");
	} catch (error) {
		if (!(error instanceof Error && "code" in error && error.code === "ENOENT"))
			throw error;
	}
	const evaluator = validateEvaluator(
		await json(join(options.evaluators, "manifest.json")),
	);
	const git = await exec(
		"git",
		["ls-files", "-co", "--exclude-standard", "-z"],
		{ cwd: template, maxBuffer: 10_000_000 },
	);
	const source = options.baseline ? resolve(options.baseline) : template;
	const names = options.baseline
		? await files(source, true)
		: [...new Set(git.stdout.split("\0").filter(Boolean).filter(sourcePath))]
				.filter((name) => {
					const path = resolve(template, name);
					return (
						!path.startsWith(`${resolve(options.evaluators)}${sep}`) &&
						!path.startsWith(`${resolve(options.briefs)}${sep}`)
					);
				})
				.sort();
	const existing: string[] = [];
	for (const name of names) {
		try {
			await lstat(inside(source, name));
			existing.push(name);
		} catch (error) {
			if (
				!(error instanceof Error && "code" in error && error.code === "ENOENT")
			)
				throw error;
		}
	}
	const control = join(output, "control");
	await copy(
		options.evaluators,
		join(control, "evaluators"),
		await files(options.evaluators),
	);
	await copy(
		options.briefs,
		join(control, "briefs"),
		evaluator.tasks.map((task) => task.brief),
	);
	await copy(source, join(control, "baseline"), existing);
	const templateSourceHashes = await hashes(source, existing);
	const manifest: Manifest = {
		version: 1,
		createdAt: new Date().toISOString(),
		templateRoot: template,
		templateCommit: (
			await exec("git", ["rev-parse", "HEAD"], { cwd: template })
		).stdout.trim(),
		templateSourceHashes,
		skillHashes: Object.fromEntries(
			Object.entries(templateSourceHashes).filter(([name]) =>
				name.startsWith(".agents/skills/"),
			),
		),
		referenceHashes: Object.fromEntries(
			Object.entries(templateSourceHashes).filter(
				([name]) => name.startsWith("docs/") || name === "AGENTS.md",
			),
		),
		controlHashes: await hashes(control, await files(control)),
		requirements: evaluator.phase === 5 ? phase5Requirements : requirements,
		repeats: options.repeats,
	};
	if (!Object.keys(manifest.skillHashes).length)
		throw new Error("No skill sources found");
	await save(join(output, "manifest.json"), manifest);
	await writeFile(
		join(output, "manifest.sha256"),
		hash(await readFile(join(output, "manifest.json"))),
	);
	for (let repeat = 1; repeat <= options.repeats; repeat++) {
		const directory = join(output, `run-${repeat}`);
		await copy(source, join(directory, "candidate"), existing);
		await save(join(directory, "result.json"), { checks: {} });
	}
	return {
		output,
		templateCommit: manifest.templateCommit,
		repeats: manifest.repeats,
		candidates: Array.from({ length: manifest.repeats }, (_, i) =>
			join(output, `run-${i + 1}`, "candidate"),
		),
	};
}
/** Capture a pristine manually prepared source fixture before dispatching an agent. */
export async function snapshotEvaluationSource(source: string, target: string) {
	try {
		await stat(target);
		throw new Error("Snapshot destination already exists");
	} catch (error) {
		if (!(error instanceof Error && "code" in error && error.code === "ENOENT"))
			throw error;
	}
	const names = await files(source, true);
	await copy(source, target, names);
	return { source, target, hashes: await hashes(target, names) };
}
/** Import a real externally dispatched run without copying dependencies or credentials. */
export async function adoptEvaluationCandidate(
	output: string,
	repeat: number,
	source: string,
) {
	const current = await state(output, repeat);
	await retainAttempt(current.directory, current.run);
	const destination = join(current.directory, "candidate");
	if (resolve(source) === destination)
		throw new Error("Cannot adopt candidate into itself");
	const names = await files(source, true);
	for (const name of await files(destination, true)) {
		if (!names.includes(name)) await unlink(inside(destination, name));
	}
	await copy(source, destination, names);
	await save(join(current.directory, "result.json"), {
		candidatePath: resolve(source),
		checks: {},
	});
	return {
		candidate: resolve(source),
		sourceHashes: await hashes(destination, names),
	};
}
export async function assertEvaluationIntegrity(output: string) {
	const manifestPath = join(output, "manifest.json");
	if (
		hash(await readFile(manifestPath)) !==
		(await readFile(join(output, "manifest.sha256"), "utf8"))
	)
		throw new Error("Evaluation manifest integrity failed");
	const manifest = (await json(manifestPath)) as Manifest;
	const control = join(output, "control");
	if (
		!same(await hashes(control, await files(control)), manifest.controlHashes)
	)
		throw new Error("Held-out expectations/baseline integrity failed");
	return manifest;
}
async function state(output: string, repeat: number) {
	const manifest = await assertEvaluationIntegrity(output);
	if (!Number.isInteger(repeat) || repeat < 1 || repeat > manifest.repeats)
		throw new Error("Unknown repeat");
	const directory = join(output, `run-${repeat}`);
	const run = (await json(join(directory, "result.json"))) as Run;
	return {
		manifest,
		directory,
		candidate: run.candidatePath ?? join(directory, "candidate"),
		run,
	};
}
async function retainAttempt(directory: string, run: Run) {
	if (!run.agent && !Object.keys(run.checks).length) return;
	const history = join(directory, "attempts", `${Date.now()}-${randomUUID()}`);
	await mkdir(history, { recursive: true });
	await save(join(history, "result.json"), run);
	for (const file of ["source.diff", run.agent?.transcript].filter(
		(file): file is string => Boolean(file),
	)) {
		try {
			await copyFile(join(directory, file), join(history, file));
		} catch (error) {
			if (
				!(error instanceof Error && "code" in error && error.code === "ENOENT")
			)
				throw error;
		}
	}
}
export async function recordAgentEvidence(
	output: string,
	repeat: number,
	evidence: unknown,
) {
	const current = await state(output, repeat);
	const agent = agentSchema.parse(evidence);
	unique(agent.taskIds, "agent task IDs");
	if (
		agent.taskIds.some(
			(id) => !Object.hasOwn(current.manifest.requirements, id),
		)
	)
		throw new Error("Unknown agent task ID");
	if (!isAbsolute(agent.transcriptPath))
		throw new Error("Transcript must use an absolute path");
	const transcript = await readFile(agent.transcriptPath);
	if (transcript.toString().trim().length < 80)
		throw new Error("Retain a substantive transcript of the actual AI run");
	await retainAttempt(current.directory, current.run);
	await copyFile(
		agent.transcriptPath,
		join(current.directory, "agent-transcript.md"),
	);
	const { transcriptPath: _path, ...metadata } = agent;
	current.run.agent = {
		...metadata,
		transcript: "agent-transcript.md",
		transcriptHash: hash(transcript),
		recordedAt: new Date().toISOString(),
	};
	current.run.checks = {};
	delete current.run.applicationChecks;
	await save(join(current.directory, "result.json"), current.run);
	return current.run.agent;
}
/** A zero exit code cannot substitute for executed, named held-out behavioral cases. */
export function verifyCaseReport(
	output: string,
	taskId: string,
	check: Pick<Check, "id" | "caseIds">,
) {
	const reports = output
		.split(/\r?\n/)
		.filter((line) => line.startsWith("PHASE4_RESULT="));
	if (reports.length !== 1)
		throw new Error("Expected exactly one PHASE4_RESULT report");
	const report = caseReportSchema.parse(
		JSON.parse(reports[0].slice("PHASE4_RESULT=".length)),
	);
	if (report.taskId !== taskId || report.checkId !== check.id)
		throw new Error("Behavioral report belongs to another task/check");
	unique(
		report.cases.map((item) => item.id),
		"reported case IDs",
	);
	if (
		!same(
			[...report.cases.map((item) => item.id)].sort(),
			[...check.caseIds].sort(),
		)
	)
		throw new Error("Required behavioral cases missing or unexpected");
	if (report.cases.some((item) => item.status !== "passed"))
		throw new Error("Required behavioral case failed or skipped");
}
async function command(
	argv: string[],
	cwd: string,
	timeout: number,
	env: NodeJS.ProcessEnv,
) {
	return new Promise<{
		output: string;
		exitCode: number | null;
		timedOut: boolean;
	}>((done) => {
		let output = "";
		let timedOut = false;
		const child = spawn(argv[0], argv.slice(1), {
			cwd,
			env,
			detached: process.platform !== "win32",
			stdio: ["ignore", "pipe", "pipe"],
		});
		const stop = () => {
			try {
				if (process.platform !== "win32" && child.pid)
					process.kill(-child.pid, "SIGKILL");
				else child.kill("SIGKILL");
			} catch {
				/* The process group may already have exited. */
			}
		};
		const timer = setTimeout(() => {
			timedOut = true;
			stop();
		}, timeout);
		const append = (chunk: Buffer) => {
			if (output.length >= 32 * 1024 * 1024) {
				stop();
				return;
			}
			output += chunk.toString();
		};
		child.stdout.on("data", append);
		child.stderr.on("data", append);
		child.on("error", (error) => {
			output += `${error.message}\n`;
		});
		child.on("close", (exitCode) => {
			clearTimeout(timer);
			stop();
			done({ output, exitCode, timedOut });
		});
	});
}
export async function runEvaluation(
	output: string,
	repeat: number,
	selected?: string[],
) {
	const current = await state(output, repeat);
	const requiredTaskIds = Object.keys(current.manifest.requirements);
	selected ??= requiredTaskIds;
	if (!current.run.agent)
		throw new Error(
			"Actual AI agent evidence is required before behavioral checks",
		);
	if (selected.some((id) => !current.run.agent?.taskIds.includes(id)))
		throw new Error("AI evidence is missing for a selected task");
	if (!selected.length || selected.some((id) => !requiredTaskIds.includes(id)))
		throw new Error("Unknown/empty task selection");
	await retainAttempt(current.directory, current.run);
	const attemptId = `${Date.now()}-${randomUUID()}`;
	const sourceHashes = await hashes(
		current.candidate,
		await files(current.candidate, true),
	);
	if (!same(sourceHashes, current.run.sourceHashes)) {
		current.run.checks = {};
		delete current.run.applicationChecks;
	}
	// Diff only reviewed source, never local environment files, dependencies or logs.
	const snapshot = join(
		current.directory,
		"source-snapshots",
		hash(JSON.stringify(sourceHashes)),
	);
	await copy(current.candidate, snapshot, Object.keys(sourceHashes));
	const diff = await exec(
		"git",
		[
			"diff",
			"--no-index",
			"--no-ext-diff",
			"--",
			join(output, "control", "baseline"),
			snapshot,
		],
		{ maxBuffer: 25_000_000 },
	)
		.then((result) => result.stdout)
		.catch((error: { code: number; stdout: string }) => {
			if (error.code === 1) return error.stdout;
			throw error;
		});
	await writeFile(join(current.directory, "source.diff"), diff);
	current.run.sourceHashes = sourceHashes;
	current.run.diffHash = hash(diff);
	const evaluator = validateEvaluator(
		await json(join(output, "control", "evaluators", "manifest.json")),
	);
	const logs = join(current.directory, "logs");
	await mkdir(logs, { recursive: true });
	const expand = (value: string) =>
		value
			.replaceAll("{candidate}", current.candidate)
			.replaceAll("{evaluators}", join(output, "control", "evaluators"))
			.replaceAll("{template}", current.manifest.templateRoot);
	// The invoked tool owns NODE_ENV: Vitest selects test; Next build selects production.
	const env = {
		PATH: process.env.PATH,
		LANG: "C.UTF-8",
		CI: "1",
		PHASE4_CANDIDATE_ROOT: current.candidate,
		PHASE4_EVALUATOR_ROOT: join(output, "control", "evaluators"),
	} as unknown as NodeJS.ProcessEnv;
	async function check(
		task: string,
		spec: Check | ApplicationCheck,
	): Promise<CheckResult> {
		await assertEvaluationIntegrity(output);
		const argv = spec.argv.map(expand);
		const result = await command(argv, current.candidate, spec.timeoutMs, env);
		const log = `logs/${attemptId}-${task}-${spec.id}.log`;
		await writeFile(join(current.directory, log), result.output);
		let failure: string | undefined;
		try {
			if (result.exitCode !== 0 || result.timedOut)
				throw new Error("Command failed or timed out");
			if ("caseIds" in spec) verifyCaseReport(result.output, task, spec);
			else if (!new RegExp(spec.successPattern, "m").test(result.output))
				throw new Error("Application check success marker absent");
			await assertEvaluationIntegrity(output);
		} catch (error) {
			failure = error instanceof Error ? error.message : String(error);
		}
		return {
			passed: !failure,
			exitCode: result.exitCode,
			timedOut: result.timedOut,
			argv,
			log,
			logHash: hash(result.output),
			...(failure ? { failure } : {}),
		};
	}
	for (const task of evaluator.tasks.filter((task) =>
		selected.includes(task.id),
	)) {
		current.run.checks[task.id] = [];
		for (const spec of task.checks) {
			current.run.checks[task.id].push(await check(task.id, spec));
			await save(join(current.directory, "result.json"), current.run);
		}
	}
	current.run.applicationChecks = [];
	for (const spec of evaluator.applicationChecks) {
		current.run.applicationChecks.push(await check("application", spec));
		await save(join(current.directory, "result.json"), current.run);
	}
	await assertEvaluationIntegrity(output);
	if (
		!same(
			sourceHashes,
			await hashes(current.candidate, await files(current.candidate, true)),
		)
	)
		throw new Error("Candidate source changed during evaluation");
	return current.run;
}
export async function summarizeEvaluation(output: string) {
	const manifest = await assertEvaluationIntegrity(output);
	const evaluator: Evaluator = validateEvaluator(
		await json(join(output, "control", "evaluators", "manifest.json")),
	);
	const failures: string[] = [];
	for (let repeat = 1; repeat <= manifest.repeats; repeat++) {
		const current = await state(output, repeat);
		const prefix = `run-${repeat}`;
		if (!current.run.agent)
			failures.push(`${prefix}: actual AI run evidence missing`);
		else if (
			hash(
				await readFile(join(current.directory, current.run.agent.transcript)),
			) !== current.run.agent.transcriptHash
		)
			failures.push(`${prefix}: transcript integrity failed`);
		if (
			!same(
				current.run.sourceHashes,
				await hashes(current.candidate, await files(current.candidate, true)),
			)
		)
			failures.push(`${prefix}: unverified or changed source`);
		if (
			!current.run.diffHash ||
			hash(await readFile(join(current.directory, "source.diff"))) !==
				current.run.diffHash
		)
			failures.push(`${prefix}: source diff missing or changed`);
		for (const task of evaluator.tasks) {
			const results = current.run.checks[task.id];
			if (
				!current.run.agent?.taskIds.includes(task.id) ||
				results?.length !== task.checks.length ||
				results.some((result) => !result.passed)
			)
				failures.push(
					`${prefix}/${task.id}: missing or failed required behavior`,
				);
		}
		if (
			current.run.applicationChecks?.length !==
				evaluator.applicationChecks.length ||
			current.run.applicationChecks.some((result) => !result.passed)
		)
			failures.push(
				`${prefix}: missing or failed deterministic application checks`,
			);
		for (const result of [
			...Object.values(current.run.checks).flat(),
			...(current.run.applicationChecks ?? []),
		]) {
			if (
				hash(await readFile(inside(current.directory, result.log))) !==
				result.logHash
			)
				failures.push(`${prefix}: command log integrity failed`);
		}
	}
	return {
		accepted: failures.length === 0,
		repeats: manifest.repeats,
		requiredTasks: Object.keys(manifest.requirements),
		requirements: manifest.requirements,
		failures,
		statement:
			"Deterministic harness tests do not demonstrate AI skill behavior. This gate requires separately recorded real agent runs and held-out checks.",
	};
}

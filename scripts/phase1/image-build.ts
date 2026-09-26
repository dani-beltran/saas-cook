import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import { sourceFingerprint } from "./source-fingerprint";

const exec = promisify(execFile);
const revision = (await exec("git", ["rev-parse", "HEAD"])).stdout.trim();
const fingerprint = await sourceFingerprint();
const child = spawn(
	"docker",
	[
		"build",
		"--file",
		"infra/docker/Dockerfile",
		"--target",
		"app",
		"--build-arg",
		`SOURCE_COMMIT=${revision}`,
		"--build-arg",
		`SOURCE_FINGERPRINT=${fingerprint}`,
		"--tag",
		process.env.TEST_IMAGE ?? "common-sass:phase1",
		".",
	],
	{ stdio: "inherit" },
);
child.on("error", () => {
	process.exitCode = 1;
});
child.on("exit", (code) => {
	process.exitCode = code ?? 1;
});

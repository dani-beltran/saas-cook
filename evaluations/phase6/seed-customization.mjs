import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const output = path.resolve(process.argv[2]);
const helper =
	'\n// Existing customer support customization: retain while extending this workflow.\nfunction commercialSupportCopy(locale: "en" | "es") {\n\treturn locale === "es"\n\t\t? "Soporte comercial personalizado: CASE-6801"\n\t\t: "Custom commercial support: CASE-6801";\n}\n';
const digest = (value) => createHash("sha256").update(value).digest("hex");
const records = [];
for (const repeat of [1, 2]) {
	const file = "packages/db/src/commercial-workflows.ts",
		target = path.join(output, `run-${repeat}/candidate`, file);
	const before = await readFile(target, "utf8");
	assert.ok(
		!before.includes("function commercialSupportCopy"),
		"Customization already seeded; do not repeat effects",
	);
	assert.ok(before.includes("return {"));
	const after =
		before.replace(
			"return {",
			"return {\n\t\tsupportCopy: commercialSupportCopy,",
		) + helper;
	await writeFile(target, after);
	records.push({
		repeat,
		path: file,
		beforeSha256: digest(before),
		afterSha256: digest(after),
		customFunctionSha256: digest(helper),
	});
}
await writeFile(
	path.join(output, "customization-checkpoint.json"),
	`${JSON.stringify({ version: 1, createdAt: new Date().toISOString(), reason: "Seed existing developer-owned localized support behavior at the planned partial stop, before resumed evolution.", records }, null, 2)}\n`,
);
console.log(JSON.stringify({ passed: true, records }));

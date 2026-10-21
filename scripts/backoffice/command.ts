import { open, readFile } from "node:fs/promises";
import { publishOperatorModel } from "@saas-cook/authz/platform";
import { manageOperator } from "@saas-cook/backoffice/management";
import { Pool } from "pg";

const mode = process.argv[2],
	env = process.env;
const required = (key: string) => {
	const v = env[key];
	if (!v) throw new Error(`Missing ${key}`);
	return v;
};
const control = new Pool({
	connectionString: required(
		mode === "publish" ? "CONTROL_ADMIN_DATABASE_URL" : "CONTROL_DATABASE_URL",
	),
	max: 1,
});
let app: Pool | undefined;
try {
	if (mode === "publish")
		await publishOperatorModel(
			control,
			required("INSTALLATION_ID"),
			required("OPENFGA_API_URL"),
		);
	else if (mode === "manage") {
		const approval = process.argv[3],
			output = process.argv[4];
		if (!approval || !output)
			throw new Error("Usage: manage APPROVAL_FILE PRIVATE_OUTPUT_FILE");
		app = new Pool({
			connectionString: required("BACKOFFICE_MANAGEMENT_DATABASE_URL"),
			max: 1,
		});
		const outputFile = await open(output, "wx", 0o600);
		try {
			const result = await manageOperator({
				app,
				control,
				installationId: required("INSTALLATION_ID"),
				environment: required("BACKOFFICE_ENVIRONMENT"),
				sponsorPublicKey: await readFile(
					required("BACKOFFICE_SPONSOR_PUBLIC_KEY_FILE"),
					"utf8",
				),
				securityPublicKey: await readFile(
					required("BACKOFFICE_SECURITY_PUBLIC_KEY_FILE"),
					"utf8",
				),
				approval: JSON.parse(await readFile(approval, "utf8")),
			});
			await outputFile.writeFile(JSON.stringify(result));
			await outputFile.sync();
		} finally {
			await outputFile.close();
		}
	} else throw new Error("Expected publish or manage");
} catch {
	console.error(
		"Backoffice command failed; no credentials or approval payload logged",
	);
	process.exitCode = 1;
} finally {
	await app?.end();
	await control.end();
}

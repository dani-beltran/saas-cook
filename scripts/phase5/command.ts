import { readFile } from "node:fs/promises";
import { parseArgs } from "node:util";
import { Pool } from "pg";
import { createAuthorizationService } from "../../packages/authz/src/index";
import {
	readMigrationEnv,
	readWorkerEnv,
} from "../../packages/config/src/server";
import { installBillingCatalogue } from "../../packages/db/src/billing/catalogue";
import { createStripeProvider } from "../../packages/db/src/billing/stripe";
import { rebuildUsage } from "../../packages/db/src/billing/usage";
import {
	billingTransaction,
	createBillingWorker,
} from "../../packages/db/src/billing/worker";

const { positionals, values } = parseArgs({
	allowPositionals: true,
	options: {
		file: { type: "string" },
		organization: { type: "string" },
		bucket: { type: "string" },
		help: { type: "boolean" },
	},
});
const uuid = (s: string | undefined) => {
	if (
		!s ||
		!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s)
	)
		throw new Error("An explicit UUID scope is required");
	return s;
};
async function main() {
	if (positionals[0] === "catalogue") {
		if (!values.file) throw new Error("--file is required");
		const p = new Pool({
			connectionString: readMigrationEnv().MIGRATION_DATABASE_URL,
		});
		try {
			console.info(
				JSON.stringify(
					await installBillingCatalogue(
						p,
						JSON.parse(await readFile(values.file, "utf8")),
					),
				),
			);
		} finally {
			await p.end();
		}
		return;
	}
	const organization = uuid(values.organization),
		env = readWorkerEnv(),
		pool = new Pool({ connectionString: env.WORKER_DATABASE_URL }),
		controlPool = new Pool({ connectionString: env.CONTROL_DATABASE_URL }),
		authorization = createAuthorizationService({
			controlPool,
			installationId: env.INSTALLATION_ID,
			openfgaUrl: env.OPENFGA_API_URL,
		});
	try {
		if (positionals[0] === "reconcile") {
			if (env.BILLING_ENABLED !== "true") throw new Error("Stripe is disabled");
			const provider = createStripeProvider({
				secretKey: env.STRIPE_SECRET_KEY as string,
				accountId: env.STRIPE_ACCOUNT_ID as string,
				mode: env.STRIPE_MODE,
				webhookSecret: env.STRIPE_WEBHOOK_SECRET as string,
				portalConfigurationId: env.STRIPE_PORTAL_CONFIGURATION_ID as string,
			});
			await createBillingWorker(pool, authorization, {
				provider,
				origin: env.APP_ORIGIN,
			}).processAccount(organization);
		} else if (positionals[0] === "rebuild") {
			const bucket = uuid(values.bucket),
				c = await pool.connect();
			try {
				await billingTransaction(c, organization, authorization, () =>
					rebuildUsage(c, organization, bucket),
				);
			} finally {
				c.release();
			}
		} else if (positionals[0] !== "diagnostics")
			throw new Error("Use catalogue, reconcile, rebuild or diagnostics");
		const c = await pool.connect();
		try {
			const result = await billingTransaction(
				c,
				organization,
				authorization,
				async () => ({
					billing: (
						await c.query(
							"SELECT source_version,provider_status,access_state,health,reconciled_at,valid_until FROM tenancy.billing_accounts WHERE organization_id=$1",
							[organization],
						)
					).rows,
					commands: (
						await c.query(
							"SELECT id,kind,state,attempts,error_code FROM tenancy.billing_commands WHERE organization_id=$1 ORDER BY created_at DESC LIMIT 50",
							[organization],
						)
					).rows,
					usage: (
						await c.query(
							"SELECT id,metric,period_start,period_end,consumed,reserved,watermark,aggregate_version FROM tenancy.quota_buckets WHERE organization_id=$1 ORDER BY period_start DESC LIMIT 24",
							[organization],
						)
					).rows,
				}),
			);
			console.info(JSON.stringify(result));
		} finally {
			c.release();
		}
	} finally {
		await Promise.all([pool.end(), controlPool.end()]);
	}
}
if (values.help)
	console.info(
		"billing-catalogue --file <catalogue.json> | billing-reconcile --organization <uuid> | billing-diagnostics --organization <uuid> | usage-rebuild --organization <uuid> --bucket <uuid>",
	);
else
	main().catch(() => {
		console.error(
			"Billing command failed; check configuration, scope, catalogue and reconciliation status. Provider payloads are not logged.",
		);
		process.exitCode = 1;
	});

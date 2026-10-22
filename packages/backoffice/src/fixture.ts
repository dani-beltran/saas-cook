import { generateKeyPairSync, randomUUID, sign } from "node:crypto";
import { publishOperatorModel } from "@saas-cook/authz/platform";
import { Pool } from "pg";
import { createTestInstallation } from "../../testing/src/installation";
import { manageOperator } from "./management";

/** Disposable, synthetic staff installation for real-service/browser tests; never enrolls a real account. */
export async function backofficeFixture(origin = "http://localhost:3103") {
	const installation = await createTestInstallation();
	const role = (name: string) => {
		const u = new URL(installation.migrationUrl);
		u.username = name;
		return u.toString();
	};
	const migration = new Pool({ connectionString: installation.migrationUrl }),
		control = new Pool({ connectionString: installation.controlUrl }),
		manager = new Pool({ connectionString: role("saas_cook_bo_manager") });
	const env = {
		NODE_ENV: "test" as const,
		...installation.env,
		BACKOFFICE_ORIGIN: origin,
		BACKOFFICE_AUTH_SECRET: "synthetic_backoffice_auth_000000000000000001",
		BACKOFFICE_IDENTITY_DATABASE_URL: role("saas_cook_bo_identity"),
		BACKOFFICE_DATABASE_URL: role("saas_cook_bo_query"),
		BACKOFFICE_ENVIRONMENT: "test",
	};
	try {
		await publishOperatorModel(
			control,
			env.INSTALLATION_ID,
			env.OPENFGA_API_URL,
		);
		const epoch = (
			await control.query(
				"SELECT epoch FROM control.installations WHERE installation_id=$1",
				[env.INSTALLATION_ID],
			)
		).rows[0].epoch;
		const organizationId = randomUUID(),
			otherOrganizationId = randomUUID(),
			operatorId = randomUUID();
		for (const id of [organizationId, otherOrganizationId]) {
			await migration.query(
				"INSERT INTO tenancy.organizations(id,name,slug) VALUES($1,$2,$3)",
				[
					id,
					id === organizationId
						? "Synthetic authorized organization"
						: "Other organization",
					id,
				],
			);
			await migration.query(
				"INSERT INTO tenancy.seat_capacities(organization_id,capacity) VALUES($1,5)",
				[id],
			);
		}
		const sponsor = generateKeyPairSync("ed25519"),
			security = generateKeyPairSync("ed25519");
		const input = {
			version: 1,
			nonce: randomUUID(),
			installationId: env.INSTALLATION_ID,
			environment: "test",
			epoch,
			expiresAt: new Date(Date.now() + 240000).toISOString(),
			action: "invite",
			operatorId,
			email: `staff-${operatorId}@example.test`,
			name: "Synthetic operator",
			organizationIds: [organizationId],
			grantExpiresAt: new Date(Date.now() + 86400000).toISOString(),
			caseReference: "TEST-1",
		};
		async function manage(
			action: "invite" | "offboard" | "reenroll",
			overrides: Record<string, unknown> = {},
		) {
			const body = Buffer.from(
				JSON.stringify({ ...input, action, nonce: randomUUID(), ...overrides }),
			);
			return manageOperator({
				app: manager,
				control,
				installationId: env.INSTALLATION_ID,
				environment: "test",
				sponsorPublicKey: sponsor.publicKey
					.export({ type: "spki", format: "pem" })
					.toString(),
				securityPublicKey: security.publicKey
					.export({ type: "spki", format: "pem" })
					.toString(),
				approval: {
					payload: body.toString("base64url"),
					sponsor: sign(null, body, sponsor.privateKey).toString("base64url"),
					security: sign(null, body, security.privateKey).toString("base64url"),
				},
			});
		}
		const invited = await manage("invite");
		if (!invited.invitation) throw new Error("Fixture invitation missing");
		return {
			env,
			migration,
			control,
			organizationId,
			otherOrganizationId,
			operatorId,
			epoch,
			invitation: invited.invitation,
			offboard: () => manage("offboard"),
			manage,
			headers() {
				return { origin };
			},
			async cleanup() {
				await Promise.all([migration.end(), manager.end()]);
				const row = (
					await control.query(
						"SELECT store_id FROM control.operator_publications WHERE installation_id=$1",
						[env.INSTALLATION_ID],
					)
				).rows[0];
				if (row)
					await fetch(`${env.OPENFGA_API_URL}/stores/${row.store_id}`, {
						method: "DELETE",
					});
				await control.end();
				await installation.cleanup();
			},
		};
	} catch (e) {
		await Promise.all([migration.end(), control.end(), manager.end()]);
		await installation.cleanup();
		throw e;
	}
}

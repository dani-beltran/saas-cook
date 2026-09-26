import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { createAuthorizationService } from "../../packages/authz/src/index";
import { createResourceService } from "../../packages/db/src/resources";
import {
	createTenancyService,
	type TenantActor,
} from "../../packages/db/src/tenancy";
import { createTestInstallation } from "../../packages/testing/src/installation";

/** Disposable real-service fixture; application operations always use the restricted role. */
export async function resourceFixture(
	options: {
		defaultProjectCapacity?: number | null;
		onFenceWait?: (milliseconds: number) => void;
		poolSize?: number;
	} = {},
) {
	const installation = await createTestInstallation();
	const app = new Pool({ connectionString: installation.migrationUrl, max: 5 });
	const web = new Pool({
		connectionString: installation.env.DATABASE_URL,
		max: options.poolSize ?? 8,
	});
	const identity = new Pool({
		connectionString: installation.env.IDENTITY_DATABASE_URL,
		max: 5,
	});
	const reader = new Pool({
		connectionString: installation.env.CONTROL_DATABASE_URL,
		max: options.poolSize ?? 8,
	});
	const authorization = createAuthorizationService({
		controlPool: reader,
		installationId: installation.env.INSTALLATION_ID,
		openfgaUrl: installation.env.OPENFGA_API_URL,
	});
	const invitations = new Map<string, string>();
	const tenancy = createTenancyService(
		web,
		{
			...authorization,
			notify: async (_client, notification) => {
				if (notification.kind === "invite" && notification.token)
					invitations.set(notification.referenceId, notification.token);
			},
		},
		{ defaultSeatCapacity: 100 },
	);
	const resources = createResourceService(
		web,
		{
			authorize: authorization.authorizeResource,
			check: authorization.checkResource,
			checkBatch: authorization.checkResourceBatch,
			sourceCommit: authorization.sourceCommit,
		},
		options,
	);
	async function user(): Promise<TenantActor> {
		const id = randomUUID();
		await identity.query(
			'INSERT INTO identity."user"(id,name,email,email_verified) VALUES($1,$1,$2,true)',
			[id, `${id}@example.test`],
		);
		return {
			userId: id,
			authenticatedAt: new Date(),
			mfa: true,
			method: "passkey",
		};
	}
	async function organization(owner: TenantActor) {
		const id = randomUUID();
		return tenancy.createOrganization(owner, {
			name: `Synthetic ${id}`,
			slug: `org-${id}`,
			operationKey: id,
		});
	}
	async function member(owner: TenantActor, org: string, actor: TenantActor) {
		const invitation = await tenancy.invite(owner, org, {
			email: `${actor.userId}@example.test`,
			role: "member",
			operationKey: randomUUID(),
		});
		const token = invitations.get(invitation.id);
		if (!token) throw new Error("Missing invitation delivery");
		await tenancy.acceptInvitation(actor, org, {
			token,
			operationKey: randomUUID(),
		});
		return (
			await app.query<{ id: string }>(
				"SELECT id FROM tenancy.memberships WHERE organization_id=$1 AND user_id=$2",
				[org, actor.userId],
			)
		).rows[0].id;
	}
	async function cleanup() {
		await Promise.all([app.end(), web.end(), identity.end(), reader.end()]);
		await installation.cleanup();
	}
	return {
		installation,
		app,
		web,
		identity,
		reader,
		authorization,
		tenancy,
		resources,
		user,
		organization,
		member,
		cleanup,
	};
}

import { randomUUID } from "node:crypto";
import { createAuthorizationService } from "../../packages/authz/src/index";
import { createResourceService } from "../../packages/db/src/resources";
import {
	createTenancyService,
	type TenantActor,
} from "../../packages/db/src/tenancy";
import { createTestInstallation } from "../../packages/testing/src/installation";
import {
	closeFixturePool,
	createFixturePool,
	type FixturePoolOptions,
} from "../../packages/testing/src/pool";

/** Creates disposable real-service resources with restricted application roles.
 * @param options Resource policy, pool size and optional failure observation/SQL bounds.
 * @returns Services, fixture pools and cleanup that attempts all pool/installation closes.
 * @throws Setup or cleanup failures; raw database errors can contain connection details.
 */
export async function resourceFixture(
	options: FixturePoolOptions & {
		defaultProjectCapacity?: number | null;
		defaultProjectCreatesPerMonth?: number | null;
		onFenceWait?: (milliseconds: number) => void;
		poolSize?: number;
	} = {},
) {
	const installation = await createTestInstallation(options);
	const app = createFixturePool(
		{ connectionString: installation.migrationUrl, max: 5 },
		"resource-application",
		options,
	);
	const web = createFixturePool(
		{
			connectionString: installation.env.DATABASE_URL,
			max: options.poolSize ?? 8,
		},
		"resource-web",
		options,
	);
	const identity = createFixturePool(
		{
			connectionString: installation.env.IDENTITY_DATABASE_URL,
			max: 5,
		},
		"resource-identity",
		options,
	);
	const reader = createFixturePool(
		{
			connectionString: installation.env.CONTROL_DATABASE_URL,
			max: options.poolSize ?? 8,
		},
		"resource-control",
		options,
	);
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
		const closed = await Promise.allSettled(
			[app, web, identity, reader].map((pool) => closeFixturePool(pool)),
		);
		const failures: unknown[] = closed.flatMap((result) =>
			result.status === "rejected" ? [result.reason] : [],
		);
		try {
			await installation.cleanup();
		} catch (error) {
			failures.push(error);
		}
		if (failures.length)
			throw new AggregateError(failures, "Resource fixture cleanup failed");
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

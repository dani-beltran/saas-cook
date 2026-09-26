import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { resourceFixture } from "../../../scripts/phase3/fixture";
import { createApiKeyService } from "./keys";

const cleanup: Array<() => Promise<void>> = [];
afterEach(async () => {
	for (const action of cleanup.splice(0).reverse()) await action();
});

describe("Key-management authorization deadlines", () => {
	it.each([
		["issue", "membership"],
		["rotate", "membership"],
		["issue", "session"],
		["issue", "fresh authentication"],
	] as const)(
		"rolls back %s and its side effects when administrator %s expires during SQL",
		async (operation, eligibility) => {
			const f = await resourceFixture();
			cleanup.push(f.cleanup);
			const owner = await f.user();
			const admin = await f.user();
			const org = (await f.organization(owner)).id;
			const membership = await f.member(owner, org, admin);
			const keys = createApiKeyService({
				pool: f.web,
				authorization: f.authorization,
			});
			const account = await keys.createAccount(owner, org, {
				name: "Expiry regression",
				capabilities: ["project:read"],
				operationKey: randomUUID(),
			});
			const input = {
				serviceAccountId: account.id,
				scopes: ["project:read"],
				expiresAt: new Date(Date.now() + 60_000),
				operationKey: randomUUID(),
			};
			const old = await keys.issue(owner, org, input);
			const snapshot = async () =>
				(
					await f.app.query(
						`SELECT desired_revision,applied_revision,
					(SELECT count(*) FROM tenancy.api_keys WHERE organization_id=$1) AS keys,
					(SELECT count(*) FROM tenancy.audit_events WHERE organization_id=$1) AS audit,
					(SELECT count(*) FROM tenancy.outbox_events WHERE organization_id=$1) AS outbox
					FROM tenancy.authorization_revisions WHERE organization_id=$1`,
						[org],
					)
				).rows[0];
			const before = await snapshot();
			const { deadline } = (
				await f.app.query<{ deadline: Date }>(
					"UPDATE tenancy.memberships SET role='admin',expires_at=CASE WHEN $2='membership' THEN clock_timestamp()+interval '2 seconds' END WHERE id=$1 RETURNING coalesce(expires_at,clock_timestamp()+interval '2 seconds') AS deadline",
					[membership, eligibility],
				)
			).rows[0];
			const actor = {
				...admin,
				authenticatedAt:
					eligibility === "fresh authentication"
						? new Date(deadline.getTime() - 300_000)
						: admin.authenticatedAt,
				// Production identity validation supplies the authoritative session deadline.
				assertCurrent: async () =>
					eligibility === "session" ? deadline : undefined,
			};
			let expiredDuringWork = false;
			const delayed = createApiKeyService({
				pool: f.web,
				authorization: {
					...f.authorization,
					async sourceCommit(client, organizationId) {
						await f.authorization.sourceCommit(client, organizationId);
						// Keep actual restricted-role SQL/FGA and cross the deadline after writes.
						await client.query(
							"SELECT pg_sleep(greatest(0,extract(epoch FROM ($1::timestamptz-clock_timestamp())))+0.03)",
							[deadline],
						);
						expiredDuringWork = (
							await client.query(
								"SELECT clock_timestamp()>$1::timestamptz AS expired",
								[deadline],
							)
						).rows[0].expired;
					},
				},
			});
			const command =
				operation === "issue"
					? delayed.issue(actor, org, { ...input, operationKey: randomUUID() })
					: delayed.rotate(actor, org, {
							keyId: old.id,
							expiresAt: input.expiresAt,
							operationKey: randomUUID(),
						});
			await expect(command.then(() => undefined)).rejects.toMatchObject({
				code: "DENIED",
			});
			expect(expiredDuringWork).toBe(true);
			expect(await snapshot()).toEqual(before);
			await expect(keys.authenticate(org, old.secret)).resolves.toMatchObject({
				apiKeyId: old.id,
			});
			// An expired attempt must not poison the next human transaction in the pool.
			await expect(
				keys
					.issue(owner, org, { ...input, operationKey: randomUUID() })
					.then(() => undefined),
			).resolves.toBeUndefined();
		},
	);
});

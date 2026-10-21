import { randomUUID } from "node:crypto";
import { createSmtpTransport, renderOptionalEmail } from "@saas-cook/email";
import { Pool } from "pg";
import { afterAll, beforeAll, expect, it } from "vitest";
import { resourceFixture } from "../../../../scripts/phase3/fixture";
import { appendTenantAudit, withTenantTransaction } from "../tenancy";
import { createNotifications } from "./notifications";
import { createSettingsService } from "./service";

let f: Awaited<ReturnType<typeof resourceFixture>>,
	lifecycle: Pool,
	settings: ReturnType<typeof createSettingsService>,
	notifications: ReturnType<typeof createNotifications>,
	owner: Awaited<ReturnType<typeof f.user>>,
	other: typeof owner,
	org: string,
	otherOrg: string;
let status = 200;
const attempts: { body: string; headers: Record<string, string> }[] = [],
	messages: { id: string; to: string; unsubscribe: string }[] = [];
beforeAll(async () => {
	f = await resourceFixture();
	const url = new URL(f.installation.env.DATABASE_URL);
	url.username = "saas_cook_lifecycle";
	lifecycle = new Pool({ connectionString: url.toString() });
	owner = await f.user();
	other = await f.user();
	for (const a of [owner, other])
		a.assertCurrent = async () => new Date(Date.now() + 60000);
	org = (await f.organization(owner)).id;
	otherOrg = (await f.organization(other)).id;
	settings = createSettingsService(
		f.web,
		{ authorize: f.authorization.authorizeResource },
		{
			secret: f.installation.env.AUTH_SECRET,
			allowedHosts: ["hooks.example.test"],
			ready: f.authorization.publication,
			transport: async (_url, body, headers) => {
				attempts.push({ body, headers });
				return {
					status,
					body: JSON.stringify({ challenge: JSON.parse(body).challenge }),
				};
			},
		},
	);
	notifications = createNotifications(
		lifecycle,
		{ authorize: f.authorization.authorizeResource },
		{
			secret: f.installation.env.AUTH_SECRET,
			ready: f.authorization.publication,
			send: async (m) => {
				messages.push(m);
				const content = await renderOptionalEmail({
					locale: m.locale,
					url: "http://localhost:3000/en/account",
					unsubscribeUrl: `http://localhost:3000/en/unsubscribe#${m.unsubscribe}`,
				});
				await createSmtpTransport({
					host: "127.0.0.1",
					port: 1026,
					from: "optional@example.test",
					secure: false,
				})({ ...content, id: m.id, to: m.to });
			},
		},
	);
});
afterAll(async () => {
	await lifecycle?.end();
	await f?.cleanup();
});
it("verifies encrypted endpoints, scopes tenant access, rotates once, retries and cancels revoked deliveries", async () => {
	const input = {
		name: "Project events",
		url: "https://hooks.example.test/events",
		events: ["project.created" as const],
		operationKey: randomUUID(),
	};
	const endpoint = await settings.addWebhook(owner, org, input);
	expect(endpoint.secret).toBeTruthy();
	expect((await settings.addWebhook(owner, org, input)).secret).toBeNull();
	await expect(settings.webhooks(other, org)).rejects.toThrow();
	expect(await settings.webhooks(other, otherOrg)).toEqual([]);
	const persisted = (
		await f.app.query(
			"SELECT secret FROM tenancy.webhook_endpoints WHERE id=$1",
			[endpoint.id],
		)
	).rows[0].secret;
	expect(persisted).not.toContain(endpoint.secret);
	expect(JSON.stringify(await settings.webhooks(owner, org))).not.toContain(
		persisted,
	);
	const verified = await settings.webhookCommand(owner, org, {
		id: endpoint.id,
		version: 1,
		operationKey: randomUUID(),
		action: "verify",
	});
	expect(verified.version).toBe(2);
	await f.resources.createProject(owner, org, {
		name: "Webhook project",
		slug: `p-${randomUUID()}`,
		operationKey: randomUUID(),
	});
	status = 503;
	await settings.deliverWebhooks(org);
	expect((await settings.deliveries(owner, org, endpoint.id))[0]).toMatchObject(
		{ state: "pending", attempts: 1, lastStatus: 503 },
	);
	await f.app.query(
		"UPDATE tenancy.webhook_deliveries SET available_at=clock_timestamp()-interval '1 second' WHERE organization_id=$1",
		[org],
	);
	const rotated = await settings.webhookCommand(owner, org, {
		id: endpoint.id,
		version: 2,
		operationKey: randomUUID(),
		action: "rotate",
	});
	expect(rotated.secret).not.toBe(endpoint.secret);
	status = 204;
	await settings.deliverWebhooks(org);
	expect(attempts.at(-1)?.headers["x-saas-signature"]).toContain("previous=");
	expect((await settings.deliveries(owner, org, endpoint.id))[0].state).toBe(
		"delivered",
	);
	await settings.webhookCommand(owner, org, {
		id: endpoint.id,
		version: 3,
		operationKey: randomUUID(),
		action: "revoke",
	});
	expect(
		(
			await f.app.query(
				"SELECT secret,previous_secret FROM tenancy.webhook_endpoints WHERE id=$1",
				[endpoint.id],
			)
		).rows[0],
	).toEqual({ secret: null, previous_secret: null });
});
it("uses current sensitive assurance, encrypted connection credentials and separately granted audit access", async () => {
	await expect(
		settings.addIntegration({ ...owner, authenticatedAt: new Date(0) }, org, {
			name: "Stale",
			url: "https://hooks.example.test",
			token: "synthetic-token-000000000",
			scopes: ["read"],
			operationKey: randomUUID(),
		}),
	).rejects.toThrow();
	const connection = await settings.addIntegration(owner, org, {
		name: "Connection",
		url: "https://hooks.example.test",
		token: "synthetic-token-000000000",
		scopes: ["read"],
		operationKey: randomUUID(),
	});
	await settings.integrationCommand(owner, org, {
		id: connection.id,
		version: 1,
		action: "check",
		operationKey: randomUUID(),
	});
	expect((await settings.integrations(owner, org))[0].state).toBe("active");
	expect(JSON.stringify(await settings.integrations(owner, org))).not.toContain(
		"synthetic-token",
	);
	await expect(settings.audit(owner, org, {})).rejects.toThrow();
	const member = (
		await f.app.query(
			"SELECT id FROM tenancy.memberships WHERE organization_id=$1 AND user_id=$2",
			[org, owner.userId],
		)
	).rows[0].id;
	await settings.grantAudit(owner, org, {
		membershipId: member,
		enabled: true,
		version: 0,
		operationKey: randomUUID(),
	});
	const first = await settings.audit(owner, org, { limit: 2 });
	expect(first.items).toHaveLength(2);
	expect(first.nextCursor).toBeTruthy();
	const next = await settings.audit(owner, org, {
		limit: 2,
		cursor: first.nextCursor ?? undefined,
	});
	expect(next.items.some((r) => first.items.some((p) => p.id === r.id))).toBe(
		false,
	);
	await expect(
		settings.audit(other, otherOrg, {
			limit: 2,
			cursor: first.nextCursor ?? undefined,
		}),
	).rejects.toThrow();
});
it("delivers optional localized mail through Mailpit, scopes notifications and honors suppression", async () => {
	await notifications.setPreferences(owner, {
		email: true,
		inApp: true,
		locale: "es",
		version: 0,
	});
	const complete = () =>
		withTenantTransaction(f.web, org, [owner.userId], false, (c) =>
			appendTenantAudit(
				c,
				org,
				owner.userId,
				"bulk.completed",
				randomUUID(),
				{ kind: "projects.export" },
				undefined,
			),
		);
	await complete();
	expect(await notifications.list(other, otherOrg)).toEqual([]);
	await notifications.deliver(org);
	expect(messages).toHaveLength(1);
	await notifications.deliver(org);
	expect(messages).toHaveLength(1);
	const list = await notifications.list(owner, org);
	await notifications.markRead(owner, org, list[0].id);
	expect((await notifications.list(owner, org))[0].read).toBe(true);
	await expect(
		notifications.unsubscribe(`${messages[0].unsubscribe}x`),
	).rejects.toThrow();
	await notifications.unsubscribe(messages[0].unsubscribe);
	await complete();
	await notifications.deliver(org);
	expect(messages).toHaveLength(1);
	expect((await notifications.preferences(owner)).suppressed).toBe(true);
	await notifications.feedback(messages[0].id);
	await expect(
		f.web.query("SELECT * FROM foundation.notification_preferences"),
	).rejects.toThrow();
});

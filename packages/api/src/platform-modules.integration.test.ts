import { randomUUID } from "node:crypto";
import { readWebEnv } from "@saas-cook/config/server";
import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { resourceFixture } from "../../../scripts/phase3/fixture";
import { handleApi } from "./handlers";
import { createPlatformRuntime } from "./platform-runtime";

const injected = vi.hoisted(() => ({ runtime: undefined as unknown }));
vi.mock("./runtime", () => ({ applicationRuntime: () => injected.runtime }));
let f: Awaited<ReturnType<typeof resourceFixture>>,
	platformModules: ReturnType<typeof createPlatformRuntime>,
	owner: Awaited<ReturnType<typeof f.user>>,
	org: string,
	foreign: string;
beforeAll(async () => {
	f = await resourceFixture();
	owner = await f.user();
	owner.assertCurrent = async () => new Date(Date.now() + 60000);
	org = (await f.organization(owner)).id;
	foreign = (await f.organization(await f.user())).id;
	const local = new URL(f.installation.env.DATABASE_URL),
		journal = new URL(f.installation.controlUrl);
	local.username = "saas_cook_lifecycle";
	journal.username = "saas_cook_journal_writer";
	const env = readWebEnv({
		...f.installation.env,
		APP_ORIGIN: "http://localhost",
		PLATFORM_ENABLED: "true",
		LIFECYCLE_DATABASE_URL: local.toString(),
		JOURNAL_DATABASE_URL: journal.toString(),
		OUTGOING_ALLOWED_HOSTS: "hooks.example.test",
	});
	platformModules = createPlatformRuntime(env, f.web, f.reader, async () => {
		throw new Error("No background job in boundary fixture");
	});
	injected.runtime = {
		platformModules,
		origin: "http://localhost",
		ready: async () => {},
		identity: {
			session: async (h: Headers) =>
				h.get("cookie") === "synthetic-owner" ? owner : null,
			assertCurrent: owner.assertCurrent,
		},
	};
});
afterAll(async () => {
	await platformModules?.close();
	await f?.cleanup();
});
const operations = {
	bulkList: ["dataJobs", "list"],
	bulkDryRun: ["dataJobs", "dryRun"],
	bulkStart: ["dataJobs", "start"],
	bulkCancel: ["dataJobs", "cancel"],
	bulkResume: ["dataJobs", "resume"],
	bulkDownload: ["dataJobs", "download"],
	personalExport: ["privacy", "exportAccount"],
	deletionPreview: ["privacy", "previewDeletion"],
	deletionRequest: ["privacy", "requestDeletion"],
	deletionConfirm: ["privacy", "confirmDeletion"],
	deletionCancel: ["privacy", "cancelDeletion"],
	deletionStatus: ["privacy", "deletionStatus"],
	analyticsGet: ["analytics", "preferences"],
	analyticsSet: ["analytics", "setPreference"],
	onboarding: ["analytics", "completeOnboarding"],
	notificationPreferences: ["notifications", "preferences"],
	notificationSave: ["notifications", "savePreferences"],
	notifications: ["notifications", "list"],
	notificationRead: ["notifications", "markRead"],
	unsubscribe: ["notifications", "unsubscribe"],
	webhooks: ["organizationSettings", "webhooks"],
	webhookCreate: ["organizationSettings", "createWebhook"],
	webhookCommand: ["organizationSettings", "webhookCommand"],
	webhookDeliveries: ["organizationSettings", "webhookDeliveries"],
	integrations: ["organizationSettings", "integrations"],
	integrationCreate: ["organizationSettings", "createIntegration"],
	integrationCommand: ["organizationSettings", "integrationCommand"],
	auditGrants: ["organizationSettings", "auditGrants"],
	auditGrant: ["organizationSettings", "grantAudit"],
	audit: ["organizationSettings", "audit"],
	flags: ["organizationSettings", "flags"],
} as const;
for (const transport of ["rpc", "rest"] as const) {
	const call = async (
		name: keyof typeof operations,
		input: unknown,
		headers: Record<string, string> = {
			cookie: "synthetic-owner",
			origin: "http://localhost",
		},
	) => {
		const read =
			transport === "rest" &&
			[
				"bulkList",
				"notificationPreferences",
				"notifications",
				"webhooks",
				"webhookDeliveries",
				"integrations",
				"auditGrants",
				"audit",
				"flags",
			].includes(name);
		const url = new URL(
			`http://localhost/api/${transport === "rpc" ? `rpc/${operations[name][0]}/${operations[name][1]}` : `v1/platform/${name}`}`,
		);
		if (read)
			for (const [key, value] of Object.entries(
				input as Record<string, unknown>,
			))
				url.searchParams.set(key, String(value));
		const response = await handleApi(
			new Request(url, {
				method: read ? "GET" : "POST",
				headers: { "content-type": "application/json", ...headers },
				...(read
					? {}
					: {
							body: JSON.stringify(
								transport === "rpc" ? { json: input } : input,
							),
						}),
			}),
			transport,
		);
		const raw = await response.json();
		return {
			status: response.status,
			body: transport === "rpc" ? raw.json : raw,
		};
	};
	it(`${transport}: rejects foreign tenants, bearer fallback, CSRF, overposting and forged deletion receipts`, async () => {
		const before = await platformModules?.analytics.preferences(owner, org);
		expect(
			(
				await call("analyticsSet", {
					organizationId: org,
					enabled: false,
					version: before?.version ?? 0,
				})
			).status,
		).toBe(200);
		expect(
			(
				await call("analyticsSet", {
					organizationId: foreign,
					enabled: false,
					version: 0,
				})
			).status,
		).toBe(403);
		expect(
			(
				await call(
					"onboarding",
					{},
					{
						cookie: "synthetic-owner",
						authorization: "Bearer invalid",
						origin: "http://localhost",
					},
				)
			).status,
		).toBe(403);
		expect(
			(
				await call(
					"onboarding",
					{},
					{ cookie: "synthetic-owner", origin: "https://foreign.test" },
				)
			).status,
		).toBe(403);
		expect(
			(
				await call("notificationSave", {
					email: true,
					inApp: true,
					locale: "en",
					version: 0,
					emailSuppressed: false,
				})
			).status,
		).toBe(422);
		expect(
			(
				await call(
					"deletionStatus",
					{ id: randomUUID(), receipt: "x".repeat(43) },
					{},
				)
			).status,
		).toBe(403);
		const exported = await call("personalExport", {});
		expect(exported.status).toBe(200);
		const data = JSON.parse(
			Buffer.from(exported.body.base64, "base64").toString(),
		);
		expect(data.profile.id).toBe(owner.userId);
		expect(JSON.stringify(data)).not.toContain("credential_epoch");
		const endpoint = await call("webhookCreate", {
			organizationId: org,
			name: "Typed endpoint",
			url: "https://hooks.example.test",
			events: ["project.created"],
			operationKey: randomUUID(),
		});
		expect(endpoint.status).toBe(200);
		expect(endpoint.body.secret).toBeTruthy();
	});
	it(`${transport}: domain groups preserve organization data and personal preference reads`, async () => {
		const jobs = await call("bulkList", { organizationId: org });
		expect(jobs.status).toBe(200);
		expect(jobs.body).toEqual([]);
		const preferences = await call("notificationPreferences", {});
		expect(preferences.status).toBe(200);
		expect(preferences.body).toMatchObject({
			email: false,
			inApp: true,
			suppressed: false,
		});
		const ownership = await call("deletionPreview", {});
		expect(ownership.status).toBe(200);
		expect(ownership.body).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					organizationId: org,
					requiresSuccessor: true,
				}),
			]),
		);
		const webhooks = await call("webhooks", { organizationId: org });
		expect(webhooks.status).toBe(200);
		expect(webhooks.body).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ name: "Typed endpoint" }),
			]),
		);
		expect(JSON.stringify(webhooks.body)).not.toContain("secret");
	});
}

it("the retired delivery-task RPC namespace is not a second API surface", async () => {
	const response = await handleApi(
		new Request("http://localhost/api/rpc/completion/personalExport", {
			method: "POST",
			headers: {
				"content-type": "application/json",
				cookie: "synthetic-owner",
				origin: "http://localhost",
			},
			body: JSON.stringify({ json: {} }),
		}),
		"rpc",
	);
	expect(response.status).toBe(404);
});

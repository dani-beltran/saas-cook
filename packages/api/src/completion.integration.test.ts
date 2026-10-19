import { randomUUID } from "node:crypto";
import { readWebEnv } from "@saas-cook/config/server";
import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { resourceFixture } from "../../../scripts/phase3/fixture";
import { handleApi } from "./handlers";
import { createPlatformRuntime } from "./platform-runtime";

const injected = vi.hoisted(() => ({ runtime: undefined as unknown }));
vi.mock("./runtime", () => ({ applicationRuntime: () => injected.runtime }));
let f: Awaited<ReturnType<typeof resourceFixture>>,
	completion: ReturnType<typeof createPlatformRuntime>,
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
	completion = createPlatformRuntime(env, f.web, f.reader, async () => {
		throw new Error("No background job in boundary fixture");
	});
	injected.runtime = {
		completion,
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
	await completion?.close();
	await f?.cleanup();
});
for (const transport of ["rpc", "rest"] as const) {
	const call = async (
		name: string,
		input: unknown,
		headers: Record<string, string> = {
			cookie: "synthetic-owner",
			origin: "http://localhost",
		},
	) => {
		const response = await handleApi(
			new Request(
				`http://localhost/api/${transport === "rpc" ? `rpc/completion/${name}` : `v1/platform/${name}`}`,
				{
					method: "POST",
					headers: { "content-type": "application/json", ...headers },
					body: JSON.stringify(transport === "rpc" ? { json: input } : input),
				},
			),
			transport,
		);
		const raw = await response.json();
		return {
			status: response.status,
			body: transport === "rpc" ? raw.json : raw,
		};
	};
	it(`${transport}: rejects foreign tenants, bearer fallback, CSRF, overposting and forged deletion receipts`, async () => {
		const before = await completion?.analytics.preferences(owner, org);
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
}

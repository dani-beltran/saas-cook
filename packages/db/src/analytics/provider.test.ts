import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import { type AnalyticsEvent, posthogProvider } from "./provider";

it("requires observable ingestion and a verified deletion receipt; sends only catalogued properties", async () => {
	const event: AnalyticsEvent = {
		id: randomUUID(),
		subject: "opaque-user",
		organization: "opaque-org",
		event: "core_action.completed",
		feature: "projects",
		synthetic: true,
		occurredAt: new Date().toISOString(),
	};
	let ingested = false,
		verified = false,
		deleted = false;
	const sent: { path: string; body: unknown }[] = [];
	const provider = posthogProvider({
		host: "https://posthog.example",
		projectId: "1",
		token: "synthetic-public-token",
		personalKey: "synthetic-private-key",
		fetch: async (url, init) => {
			const path = new URL(String(url)).pathname,
				body = init?.body ? JSON.parse(String(init.body)) : null;
			sent.push({ path, body });
			let data: unknown = {};
			if (path.endsWith("/query/"))
				data = { results: ingested ? [[event.id]] : [] };
			else if (path.endsWith("/deletion_status/"))
				data = {
					results: [
						{
							person_uuid: "provider-person",
							status: verified ? "completed" : "pending",
							created_at: new Date().toISOString(),
							delete_verified_at: verified ? new Date().toISOString() : null,
						},
					],
					next: null,
				};
			else if (path.endsWith("/bulk_delete/")) deleted = true;
			else if (path.endsWith("/persons/"))
				data = { results: [{ uuid: "provider-person" }], next: null };
			return Response.json(data);
		},
	});
	await expect(provider.capture(event)).rejects.toThrow("unresolved");
	ingested = true;
	await provider.capture(event);
	expect(sent.find((s) => s.path.endsWith("/query/"))?.body).toMatchObject({
		refresh: "force_blocking",
	});
	const capture = sent.find((s) => s.path === "/batch/")?.body as {
		batch: { properties: Record<string, unknown> }[];
	};
	expect(Object.keys(capture.batch[0].properties).sort()).toEqual(
		[
			"$process_person_profile",
			"distinct_id",
			"feature",
			"organization_id",
			"schema_version",
			"synthetic",
		].sort(),
	);
	const receipt = await provider.requestDeletion(event.subject, null);
	expect(deleted).toBe(true);
	expect(await provider.deletionComplete(receipt)).toBe(false);
	verified = true;
	expect(await provider.deletionComplete(receipt)).toBe(true);
	expect(await provider.requestDeletion(event.subject, receipt)).toEqual(
		receipt,
	);
});

it("does not confirm ingestion from a cached or unfinished provider query", async () => {
	const id = randomUUID();
	let result: Record<string, unknown> = { results: [[id]], is_cached: true };
	const provider = posthogProvider({
		host: "https://posthog.example",
		projectId: "1",
		token: "synthetic-public-token",
		personalKey: "synthetic-private-key",
		fetch: async (_url, init) => {
			expect(JSON.parse(String(init?.body)).refresh).toBe("force_blocking");
			return Response.json(result);
		},
	});
	expect(await provider.confirmIngested?.(id)).toBe(false);
	result = { query_status: { complete: false } };
	expect(await provider.confirmIngested?.(id)).toBe(false);
	result = { results: [], is_cached: false };
	expect(await provider.confirmIngested?.(id)).toBe(false);
	result = { results: [[id]], is_cached: false };
	expect(await provider.confirmIngested?.(id)).toBe(true);
});

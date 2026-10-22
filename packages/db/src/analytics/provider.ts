export interface AnalyticsEvent {
	id: string;
	subject: string;
	organization: string | null;
	event:
		| "account.signed_up"
		| "organization.created"
		| "onboarding.completed"
		| "core_action.completed"
		| "subscription.paid_started"
		| "subscription.paid_retracted";
	occurredAt: string;
	feature?: "projects" | "customers" | "files" | "imports" | "exports";
	synthetic: boolean;
}
export interface AnalyticsDeletion {
	personIds: string[];
	requestedAt: string;
	/** Opaque subject retained for a fresh absence query, including after profile removal. */
	subject?: string;
	/** Durable worker observation; deadlines never imply successful erasure. */
	verification?: {
		attempts: number;
		nextCheckAt: string;
		lastCheckedAt?: string;
		outcome: "pending" | "error" | "verified";
		verifiedAt?: string;
		alertedAt?: string;
	};
}
export interface AnalyticsProvider {
	capture(event: AnalyticsEvent): Promise<void>;
	confirmIngested?(id: string): Promise<boolean>;
	requestDeletion(
		subject: string,
		previous: AnalyticsDeletion | null,
	): Promise<AnalyticsDeletion>;
	deletionComplete(receipt: AnalyticsDeletion): Promise<boolean>;
}
/**
 * Create the HTTPS PostHog adapter with separate ingestion and query/deletion credentials.
 * Requests use the optional fetch transport (the global transport by default) and a
 * three-second deadline. Capture throws while ingestion is unconfirmed; callers must
 * retain uncertain attempts. Deletion completes only on a verified provider receipt and fresh event absence.
 */
export function posthogProvider(options: {
	host: string;
	projectId: string;
	token: string;
	personalKey: string;
	fetch?: typeof fetch;
}): AnalyticsProvider {
	const root = new URL(options.host);
	if (
		root.protocol !== "https:" ||
		root.username ||
		root.password ||
		!/^[0-9]+$/.test(options.projectId)
	)
		throw new Error("Invalid PostHog configuration");
	const send = options.fetch ?? fetch;
	async function request(path: string, body?: unknown) {
		const response = await send(new URL(path, root), {
			method: body === undefined ? "GET" : "POST",
			headers: {
				"content-type": "application/json",
				authorization: `Bearer ${options.personalKey}`,
			},
			body: body === undefined ? undefined : JSON.stringify(body),
			redirect: "error",
			signal: AbortSignal.timeout(3000),
		});
		if (!response.ok) throw new Error("Analytics provider unavailable");
		return response.json() as Promise<Record<string, unknown>>;
	}
	async function confirmIngested(id: string) {
		if (!publicId.safeParse(id).success)
			throw new Error("Invalid analytics event identity");
		const result = await request(`/api/projects/${options.projectId}/query/`, {
			// Default query refresh may reuse a negative result from before ingestion.
			refresh: "force_blocking",
			query: {
				kind: "HogQLQuery",
				query: `SELECT uuid FROM events WHERE uuid = '${id}' LIMIT 1`,
			},
		});
		return (
			result.is_cached !== true &&
			Array.isArray(result.results) &&
			result.results.some((r) => Array.isArray(r) && r[0] === id)
		);
	}
	const base = `/api/projects/${options.projectId}/persons/`;
	return {
		confirmIngested,
		async capture(e) {
			const response = await send(new URL("/batch/", root), {
				method: "POST",
				headers: { "content-type": "application/json" },
				redirect: "error",
				signal: AbortSignal.timeout(3000),
				body: JSON.stringify({
					api_key: options.token,
					batch: [
						{
							uuid: e.id,
							event: e.event,
							timestamp: e.occurredAt,
							properties: {
								distinct_id: e.subject,
								$process_person_profile: true,
								schema_version: 1,
								...(e.organization ? { organization_id: e.organization } : {}),
								...(e.feature ? { feature: e.feature } : {}),
								synthetic: e.synthetic,
							},
						},
					],
				}),
			});
			if (!response.ok || !(await confirmIngested(e.id)))
				throw new Error("Analytics ingestion unresolved");
		},
		async requestDeletion(subject, previous) {
			if (previous) return previous;
			const persons = await request(
				`${base}?distinct_id=${encodeURIComponent(subject)}&limit=100`,
			);
			if (persons.next || !Array.isArray(persons.results))
				throw new Error("Analytics deletion lookup incomplete");
			const ids = (persons.results as { uuid?: unknown }[]).map((p) => p.uuid);
			if (ids.some((v) => typeof v !== "string"))
				throw new Error("Analytics deletion identity missing");
			if (!ids.length)
				throw new Error("Analytics ingestion/deletion identity unresolved");
			const requestedAt = new Date().toISOString();
			await request(`${base}bulk_delete/`, {
				distinct_ids: [subject],
				delete_events: true,
				delete_recordings: true,
			});
			return { personIds: ids as string[], requestedAt, subject };
		},
		async deletionComplete(receipt) {
			for (const id of receipt.personIds) {
				const result = await request(
					`${base}deletion_status/?person_uuid=${encodeURIComponent(id)}&status=all&limit=100`,
				);
				if (
					result.next ||
					!Array.isArray(result.results) ||
					!(
						result.results as {
							person_uuid?: string;
							status?: string;
							delete_verified_at?: string;
							created_at?: string;
						}[]
					).some(
						(r) =>
							r.person_uuid === id &&
							r.status === "completed" &&
							Number.isFinite(Date.parse(r.delete_verified_at ?? "")) &&
							Date.parse(r.created_at ?? "") >=
								Date.parse(receipt.requestedAt) - 1000,
					)
				)
					return false;
			}
			if (!receipt.personIds.length) return false;
			// Legacy receipts lack a subject; retain their person identities as the query scope.
			if (receipt.personIds.some((id) => !publicId.safeParse(id).success))
				throw new Error("Invalid analytics deletion identity");
			const literal = (value: string) =>
				`'${value.replaceAll("\\", "\\\\").replaceAll("'", "''")}'`;
			const scope = `person_id IN (${receipt.personIds.map(literal).join(",")})`;
			const result = await request(
				`/api/projects/${options.projectId}/query/`,
				{
					refresh: "force_blocking",
					query: {
						kind: "HogQLQuery",
						query: `SELECT uuid FROM events WHERE ${scope}${receipt.subject ? ` OR distinct_id = ${literal(receipt.subject)}` : ""} LIMIT 1`,
					},
				},
			);
			return (
				result.is_cached !== true &&
				Array.isArray(result.results) &&
				result.results.length === 0 &&
				(result.query_status as { complete?: boolean } | undefined)
					?.complete !== false
			);
		},
	};
}

import { publicId } from "@saas-cook/api-contracts/inputs/common";

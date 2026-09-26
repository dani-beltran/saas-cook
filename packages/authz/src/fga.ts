import {
	authorizationModel,
	type ContextGrant,
	compileContext,
	compileResourceContext,
	type ResourcePermission,
	type Role,
} from "./model";

export async function fgaRequest<T>(
	base: string,
	path: string,
	body?: unknown,
	method = "POST",
	timeoutMs = 3_000,
): Promise<T> {
	try {
		const response = await fetch(`${base.replace(/\/$/, "")}${path}`, {
			method,
			headers: { "content-type": "application/json" },
			...(body === undefined ? {} : { body: JSON.stringify(body) }),
			signal: AbortSignal.timeout(timeoutMs),
		});
		if (!response.ok) throw new Error("Authorization service rejected request");
		return response.status === 204
			? (undefined as T)
			: ((await response.json()) as T);
	} catch {
		throw new Error("Authorization service unavailable");
	}
}
/** No tuple-write endpoint exists in production authorization. */
export async function checkContext(
	base: string,
	storeId: string,
	modelId: string,
	context: ReturnType<typeof compileContext>,
	permission: string,
): Promise<boolean> {
	const result = await fgaRequest<{ allowed?: boolean }>(
		base,
		`/stores/${storeId}/check`,
		{
			authorization_model_id: modelId,
			tuple_key: {
				user: context.actor,
				relation: `can_${permission}`,
				object: context.object,
			},
			contextual_tuples: { tuple_keys: context.tuples },
			consistency: "HIGHER_CONSISTENCY",
		},
	);
	if (typeof result.allowed !== "boolean")
		throw new Error("Incomplete authorization response");
	return result.allowed;
}
export async function publishModel(
	base: string,
	storeId: string,
): Promise<string> {
	const model = await fgaRequest<{ authorization_model_id: string }>(
		base,
		`/stores/${storeId}/authorization-models`,
		authorizationModel,
	);
	if (!/^[A-Z0-9]{26}$/.test(model.authorization_model_id))
		throw new Error("Invalid authorization model receipt");
	return model.authorization_model_id;
}
export async function validateModel(
	base: string,
	storeId: string,
	modelId: string,
): Promise<void> {
	const cases = [
		["owner", "transfer", true],
		["admin", "transfer", false],
		["admin", "manage", true],
		["member", "manage", false],
		["member", "read", true],
		["billing", "billing", true],
		["admin", "billing", false],
		["member", "billing", false],
	] as const;
	for (const [role, permission, expected] of cases) {
		const context = compileContext({
			organizationId: "validation",
			epoch: "validation",
			actorId: "validation",
			role,
		});
		if (
			(await checkContext(base, storeId, modelId, context, permission)) !==
			expected
		)
			throw new Error("Authorization policy validation failed");
	}
	for (const member of [true, false]) {
		const context = compileContext({
			organizationId: "validation",
			epoch: "validation",
			actorId: "validation",
			role: "member",
			teamId: "team",
			teamMember: member,
		});
		if (
			(await checkContext(base, storeId, modelId, context, "read")) !== member
		)
			throw new Error("Team policy validation failed");
	}
	const resourceCases: Array<{
		role?: Role;
		actorType?: "user" | "service_account";
		grants: ContextGrant[];
		permission: ResourcePermission;
		allowed: boolean;
		workspaceId?: string;
	}> = [
		{ role: "owner", grants: [], permission: "read", allowed: true },
		{
			role: "owner",
			grants: [{ resourceId: "project", relation: "denied" }],
			permission: "read",
			allowed: true,
		},
		{
			role: "admin",
			grants: [{ resourceId: "project", relation: "denied" }],
			permission: "share",
			allowed: true,
		},
		{ role: "admin", grants: [], permission: "share", allowed: true },
		{ role: "member", grants: [], permission: "read", allowed: false },
		{ role: "billing", grants: [], permission: "read", allowed: false },
		{
			role: "member",
			grants: [{ resourceId: "project", relation: "viewer" }],
			permission: "read",
			allowed: true,
		},
		{
			role: "member",
			grants: [{ resourceId: "project", relation: "viewer" }],
			permission: "update",
			allowed: false,
		},
		{
			role: "member",
			grants: [{ resourceId: "project", relation: "editor" }],
			permission: "update",
			allowed: true,
		},
		{
			role: "member",
			grants: [{ resourceId: "project", relation: "editor" }],
			permission: "delete",
			allowed: false,
		},
		{
			role: "member",
			grants: [{ resourceId: "project", relation: "manager" }],
			permission: "share",
			allowed: true,
		},
		{
			role: "member",
			grants: [{ resourceId: "project", relation: "viewer", teamId: "team" }],
			permission: "read",
			allowed: true,
		},
		{
			role: "member",
			grants: [{ resourceId: "workspace", relation: "editor", teamId: "team" }],
			permission: "update",
			workspaceId: "workspace",
			allowed: true,
		},
		{
			role: "member",
			grants: [{ resourceId: "workspace", relation: "viewer" }],
			permission: "delete",
			workspaceId: "workspace",
			allowed: false,
		},
		{
			role: "member",
			grants: [{ resourceId: "workspace", relation: "manager" }],
			permission: "move",
			workspaceId: "workspace",
			allowed: true,
		},
		{
			role: "member",
			grants: [
				{ resourceId: "workspace", relation: "manager" },
				{ resourceId: "project", relation: "denied" },
			],
			permission: "read",
			workspaceId: "workspace",
			allowed: false,
		},
		{
			actorType: "service_account",
			grants: [],
			permission: "read",
			allowed: false,
		},
		{
			actorType: "service_account",
			grants: [{ resourceId: "project", relation: "editor" }],
			permission: "update",
			allowed: true,
		},
	];
	for (const entry of resourceCases) {
		const context = compileResourceContext({
			organizationId: "validation",
			epoch: "validation",
			actorId: "validation",
			actorType: entry.actorType ?? "user",
			role: entry.role,
			creator: false,
			target: { type: "project", id: "project" },
			workspaceId: entry.workspaceId,
			grants: entry.grants,
		});
		if (
			(await checkContext(
				base,
				storeId,
				modelId,
				context,
				entry.permission,
			)) !== entry.allowed
		)
			throw new Error("Resource policy validation failed");
	}
}

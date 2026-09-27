import { createHash, randomUUID } from "node:crypto";

const direct = { this: {} };
const relation = (name: string) => ({ computedUserset: { relation: name } });
const union = (...child: unknown[]) =>
	child.length === 1 ? child[0] : { union: { child } };
const intersection = (...child: unknown[]) => ({ intersection: { child } });
const difference = (base: unknown, subtract: unknown) => ({
	difference: { base, subtract },
});
const parent = (name: string) => ({
	tupleToUserset: {
		tupleset: { relation: "organization" },
		computedUserset: { relation: name },
	},
});
const metadata = (types: Record<string, unknown[]>) => ({
	relations: Object.fromEntries(
		Object.entries(types).map(([name, directly_related_user_types]) => [
			name,
			{ directly_related_user_types },
		]),
	),
});
const user = [{ type: "user" }];
const principals = [{ type: "user" }, { type: "service_account" }];
const subjects = [...principals, { type: "team", relation: "member" }];
function projectModel() {
	const allowed = (...relations: string[]) =>
		intersection(
			parent("can_read"),
			union(
				parent("can_manage"),
				difference(union(...relations.map(relation)), relation("denied")),
			),
		);
	return {
		type: "project",
		relations: {
			organization: direct,
			viewer: direct,
			editor: direct,
			manager: direct,
			denied: direct,
			can_read: allowed("viewer", "editor", "manager"),
			can_update: allowed("editor", "manager"),
			can_manage: allowed("manager"),
			can_delete: relation("can_manage"),
			can_restore: relation("can_manage"),
			can_share: relation("can_manage"),
		},
		metadata: metadata({
			organization: [{ type: "organization" }],
			viewer: subjects,
			editor: subjects,
			manager: subjects,
			denied: subjects,
		}),
	};
}
/** Immutable predecessor accepted only by the explicit model upgrade command. */
export const phase2ModelHash =
	"553182ddd6c5883b914ad576fd6f49adb3ddab38e7723802ac849066e3d15509";
/** Immutable published Phase 3 predecessor; the matching JSON fixture is retained. */
export const phase3ModelHash =
	"4a09e8e1d40fc8cbe1332a3e59de86f55d533506e5b1678dad9757da471aec18";
export const predecessorModelHashes = [phase2ModelHash, phase3ModelHash];
/** Versioned production compiler; no custom-role or arbitrary parent traversal. */
export const authorizationModel = {
	schema_version: "1.1",
	type_definitions: [
		{ type: "user" },
		{ type: "service_account" },
		{
			type: "organization",
			relations: {
				member: direct,
				owner: direct,
				admin: direct,
				billing: direct,
				creator: direct,
				can_create: intersection(relation("member"), relation("creator")),
				can_read: relation("member"),
				can_manage: intersection(
					relation("member"),
					union(relation("owner"), relation("admin")),
				),
				can_transfer: intersection(relation("member"), relation("owner")),
				can_billing: intersection(
					relation("member"),
					union(relation("owner"), relation("billing")),
				),
			},
			metadata: metadata({
				member: principals,
				creator: principals,
				owner: user,
				admin: user,
				billing: user,
			}),
		},
		projectModel(),
		{
			type: "team",
			relations: {
				organization: direct,
				member: direct,
				can_read: intersection(
					parent("can_read"),
					union(parent("can_manage"), relation("member")),
				),
				can_manage: parent("can_manage"),
			},
			metadata: metadata({
				organization: [{ type: "organization" }],
				member: user,
			}),
		},
	],
};
export const modelHash = createHash("sha256")
	.update(JSON.stringify(authorizationModel))
	.digest("hex");
export type Permission = "read" | "manage" | "transfer" | "billing";
export type Role = "owner" | "admin" | "member" | "billing";
export interface Tuple {
	user: string;
	relation: string;
	object: string;
}
export function safeIdentifier(value: string): string {
	if (!/^[a-zA-Z0-9_-]{1,128}$/.test(value))
		throw new Error("Unsupported authorization identifier");
	return value;
}
export function compileContext(input: {
	organizationId: string;
	epoch: string;
	actorId: string;
	role: Role;
	teamId?: string;
	teamMember?: boolean;
}) {
	const namespace = `${safeIdentifier(input.organizationId)}/${safeIdentifier(input.epoch)}/${randomUUID()}`;
	const organization = `organization:${namespace}/root`;
	const actor = `user:${safeIdentifier(input.actorId)}`;
	const tuples: Tuple[] = [
		{ user: actor, relation: "member", object: organization },
	];
	if (!["owner", "admin", "member", "billing"].includes(input.role))
		throw new Error("Unsupported authorization role");
	if (input.role !== "member")
		tuples.push({ user: actor, relation: input.role, object: organization });
	if (input.role !== "billing")
		tuples.push({ user: actor, relation: "creator", object: organization });
	const object = input.teamId
		? `team:${namespace}/${safeIdentifier(input.teamId)}`
		: organization;
	if (input.teamId) {
		tuples.push({ user: organization, relation: "organization", object });
		if (input.teamMember)
			tuples.push({ user: actor, relation: "member", object });
	}
	if (tuples.length > 100) throw new Error("Authorization context too large");
	return { actor, object, tuples };
}

export type ResourcePermission =
	| "read"
	| "create"
	| "update"
	| "delete"
	| "restore"
	| "manage"
	| "share";
export interface ResourceTarget {
	type: "organization" | "project";
	id: string;
	resourceType?: "project";
}
export interface ContextGrant {
	resourceId: string;
	relation: "viewer" | "editor" | "manager" | "denied";
	teamId?: string;
}
export function compileResourceContext(input: {
	organizationId: string;
	epoch: string;
	actorId: string;
	actorType: "user" | "service_account";
	role?: Role;
	creator: boolean;
	target: ResourceTarget;
	grants: ContextGrant[];
}) {
	if (
		!["organization", "project"].includes(input.target.type) ||
		(input.target.resourceType !== undefined &&
			input.target.resourceType !== "project") ||
		Object.keys(input).some(
			(key) =>
				![
					"organizationId",
					"epoch",
					"actorId",
					"actorType",
					"role",
					"creator",
					"target",
					"grants",
				].includes(key),
		)
	)
		throw new Error("Unsupported authorization target");
	const namespace = `${safeIdentifier(input.organizationId)}/${safeIdentifier(input.epoch)}/${randomUUID()}`;
	const organization = `organization:${namespace}/root`;
	const actor = `${input.actorType}:${safeIdentifier(input.actorId)}`;
	const object =
		input.target.type === "organization"
			? organization
			: `${input.target.type}:${namespace}/${safeIdentifier(input.target.id)}`;
	const tuples: Tuple[] = [
		{ user: actor, relation: "member", object: organization },
	];
	if (input.creator)
		tuples.push({ user: actor, relation: "creator", object: organization });
	if (input.actorType === "user" && input.role && input.role !== "member")
		tuples.push({ user: actor, relation: input.role, object: organization });
	if (object !== organization)
		tuples.push({ user: organization, relation: "organization", object });
	for (const grant of input.grants) {
		if (!["viewer", "editor", "manager", "denied"].includes(grant.relation))
			throw new Error("Unsupported grant relation");
		const target = grant.resourceId === input.target.id ? object : undefined;
		if (!target || target === organization)
			throw new Error("Unsupported grant target");
		let subject = actor;
		if (grant.teamId) {
			if (input.actorType !== "user")
				throw new Error("Unsupported service team membership");
			const team = `team:${namespace}/${safeIdentifier(grant.teamId)}`;
			tuples.push(
				{ user: actor, relation: "member", object: team },
				{ user: organization, relation: "organization", object: team },
			);
			subject = `${team}#member`;
		}
		tuples.push({ user: subject, relation: grant.relation, object: target });
	}
	const unique = [
		...new Map(tuples.map((tuple) => [JSON.stringify(tuple), tuple])).values(),
	];
	if (unique.length > 100) throw new Error("Authorization context too large");
	return { actor, object, tuples: unique };
}

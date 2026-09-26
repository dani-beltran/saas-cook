import { createHash, randomUUID } from "node:crypto";

const direct = { this: {} };
const relation = (name: string) => ({ computedUserset: { relation: name } });
const union = (...child: unknown[]) => ({ union: { child } });
const intersection = (...child: unknown[]) => ({ intersection: { child } });
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
/** Production Phase 2 policy. Its compiler intentionally has no resource/custom-role support. */
export const authorizationModel = {
	schema_version: "1.1",
	type_definitions: [
		{ type: "user" },
		{
			type: "organization",
			relations: {
				member: direct,
				owner: direct,
				admin: direct,
				billing: direct,
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
				member: user,
				owner: user,
				admin: user,
				billing: user,
			}),
		},
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

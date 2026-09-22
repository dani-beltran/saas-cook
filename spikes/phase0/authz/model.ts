/** Deliberately small executable policy: membership, teams, workspace inheritance and projects. */
const direct = { this: {} };
const computed = (relation: string) => ({ computedUserset: { relation } });
const from = (tupleset: string, relation: string) => ({
	tupleToUserset: {
		tupleset: { relation: tupleset },
		computedUserset: { relation },
	},
});
const union = (...child: unknown[]) => ({ union: { child } });
const intersection = (...child: unknown[]) => ({ intersection: { child } });
const user = { type: "user" };
const principals = [user, { type: "team", relation: "member" }];
const metadata = (relations: Record<string, unknown[]>) => ({
	relations: Object.fromEntries(
		Object.entries(relations).map(([key, types]) => [
			key,
			{ directly_related_user_types: types },
		]),
	),
});
const contentRelations = {
	organization: direct,
	viewer: direct,
	manager: direct,
	can_manage: intersection(
		from("organization", "member"),
		union(from("organization", "admin"), computed("manager")),
	),
};

export const authorizationModel = {
	schema_version: "1.1",
	type_definitions: [
		{ type: "user" },
		{
			type: "organization",
			relations: { member: direct, admin: direct },
			metadata: metadata({ member: [user], admin: [user] }),
		},
		{
			type: "team",
			relations: { member: direct },
			metadata: metadata({ member: [user] }),
		},
		{
			type: "workspace",
			relations: {
				...contentRelations,
				can_read: union(
					computed("can_manage"),
					intersection(from("organization", "member"), computed("viewer")),
				),
			},
			metadata: metadata({
				organization: [{ type: "organization" }],
				viewer: principals,
				manager: principals,
			}),
		},
		{
			type: "project",
			relations: {
				...contentRelations,
				parent: direct,
				can_read: intersection(
					from("organization", "member"),
					union(
						computed("can_manage"),
						computed("viewer"),
						from("parent", "can_read"),
					),
				),
			},
			metadata: metadata({
				organization: [{ type: "organization" }],
				parent: [{ type: "workspace" }],
				viewer: [...principals, { type: "user", condition: "before_expiry" }],
				manager: principals,
			}),
		},
	],
	conditions: {
		before_expiry: {
			name: "before_expiry",
			expression: "current_time < expires_at",
			parameters: {
				current_time: { type_name: "TYPE_NAME_TIMESTAMP" },
				expires_at: { type_name: "TYPE_NAME_TIMESTAMP" },
			},
		},
	},
};

export interface Tuple {
	user: string;
	relation: string;
	object: string;
	condition?: { name: string; context: { expires_at: string } };
}

export interface Namespace {
	organization: string;
	generation: string;
	epoch: string;
}

export function qualifyObject(object: string, namespace: Namespace): string {
	const [type, ...rest] = object.split(":");
	if (!type || rest.length !== 1 || !rest[0] || /[\s#/]/.test(rest[0]))
		throw new Error("Invalid source object");
	return `${type}:${namespace.organization}/${namespace.epoch}/${namespace.generation}/${rest[0]}`;
}

export function qualifyTuples(
	tuples: readonly Tuple[],
	namespace: Namespace,
): Tuple[] {
	return tuples.map((tuple) => {
		const [object, relation] = tuple.user.split("#");
		if (!object) throw new Error("Missing tuple user");
		const target = object.startsWith("user:")
			? object
			: qualifyObject(object, namespace);
		return {
			...structuredClone(tuple),
			user: relation ? `${target}#${relation}` : target,
			object: qualifyObject(tuple.object, namespace),
		};
	});
}

export function fixtureTuples(
	organization: string,
	resources: number,
): Tuple[] {
	const tuples: Tuple[] = [];
	for (let member = 0; member < 10; member++)
		tuples.push({
			user: `user:${organization}-u${member}`,
			relation: "member",
			object: "organization:root",
		});
	tuples.push({
		user: `user:${organization}-u0`,
		relation: "admin",
		object: "organization:root",
	});
	tuples.push({
		user: `user:${organization}-u2`,
		relation: "member",
		object: "team:editors",
	});
	for (const id of ["a", "b"]) {
		tuples.push({
			user: "organization:root",
			relation: "organization",
			object: `workspace:${id}`,
		});
		tuples.push({
			user: "team:editors#member",
			relation: "viewer",
			object: `workspace:${id}`,
		});
	}
	for (let index = 0; index < resources; index++) {
		const object = `project:r${index.toString().padStart(6, "0")}`;
		tuples.push({
			user: "organization:root",
			relation: "organization",
			object,
		});
		tuples.push({
			user: `user:${organization}-u0`,
			relation: "manager",
			object,
		});
		if (index % 100 === 0)
			tuples.push({
				user: `user:${organization}-u1`,
				relation: "viewer",
				object,
			});
	}
	return tuples;
}

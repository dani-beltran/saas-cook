import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { resourceFixture } from "../../../scripts/phase3/fixture";
import { getPublication } from "./control";
import { checkContext, fgaRequest } from "./fga";
import {
	type ContextGrant,
	compileResourceContext,
	type Role,
	type Tuple,
} from "./model";

const cleanup: Array<() => Promise<void>> = [];
afterEach(async () => {
	for (const action of cleanup.splice(0).reverse()) await action();
});

describe("Phase 3 stored policy parity", () => {
	it("matches an independently materialized complete graph for direct, team, inherited, denied and service paths", async () => {
		const f = await resourceFixture();
		cleanup.push(f.cleanup);
		const publication = await getPublication(
			f.reader,
			f.installation.env.INSTALLATION_ID,
		);
		const namespace = `parity/${randomUUID()}`;
		const organization = `organization:${namespace}/root`,
			workspace = `workspace:${namespace}/workspace`,
			project = `project:${namespace}/project`,
			team = `team:${namespace}/team`;
		const cases: Array<{
			id: string;
			role?: Role;
			service?: boolean;
			grants: ContextGrant[];
			read: boolean;
			update: boolean;
			manage: boolean;
		}> = [
			{
				id: "owner",
				role: "owner",
				grants: [{ resourceId: "project", relation: "denied" }],
				read: true,
				update: true,
				manage: true,
			},
			{
				id: "admin",
				role: "admin",
				grants: [{ resourceId: "project", relation: "denied" }],
				read: true,
				update: true,
				manage: true,
			},
			{
				id: "member",
				role: "member",
				grants: [],
				read: false,
				update: false,
				manage: false,
			},
			{
				id: "billing",
				role: "billing",
				grants: [],
				read: false,
				update: false,
				manage: false,
			},
			{
				id: "viewer",
				role: "member",
				grants: [{ resourceId: "project", relation: "viewer" }],
				read: true,
				update: false,
				manage: false,
			},
			{
				id: "editor",
				role: "member",
				grants: [{ resourceId: "project", relation: "editor" }],
				read: true,
				update: true,
				manage: false,
			},
			{
				id: "manager",
				role: "member",
				grants: [{ resourceId: "project", relation: "manager" }],
				read: true,
				update: true,
				manage: true,
			},
			{
				id: "team-reader",
				role: "member",
				grants: [{ resourceId: "project", relation: "viewer", teamId: "team" }],
				read: true,
				update: false,
				manage: false,
			},
			{
				id: "inherited-viewer",
				role: "member",
				grants: [{ resourceId: "workspace", relation: "viewer" }],
				read: true,
				update: false,
				manage: false,
			},
			{
				id: "inherited-editor",
				role: "member",
				grants: [{ resourceId: "workspace", relation: "editor" }],
				read: true,
				update: true,
				manage: false,
			},
			{
				id: "inherited-manager",
				role: "member",
				grants: [{ resourceId: "workspace", relation: "manager" }],
				read: true,
				update: true,
				manage: true,
			},
			{
				id: "denied-viewer",
				role: "member",
				grants: [
					{ resourceId: "project", relation: "viewer" },
					{ resourceId: "project", relation: "denied" },
				],
				read: false,
				update: false,
				manage: false,
			},
			{
				id: "denied-inheritance",
				role: "member",
				grants: [
					{ resourceId: "workspace", relation: "manager" },
					{ resourceId: "project", relation: "denied" },
				],
				read: false,
				update: false,
				manage: false,
			},
			{
				id: "service-reader",
				service: true,
				grants: [{ resourceId: "project", relation: "viewer" }],
				read: true,
				update: false,
				manage: false,
			},
			{
				id: "service-editor",
				service: true,
				grants: [{ resourceId: "workspace", relation: "editor" }],
				read: true,
				update: true,
				manage: false,
			},
			{
				id: "service-unassigned",
				service: true,
				grants: [],
				read: false,
				update: false,
				manage: false,
			},
		];
		// Independently materialize all principals and edges. This intentionally does not call the compiler.
		const tuples: Tuple[] = [
			{ user: organization, relation: "organization", object: workspace },
			{ user: organization, relation: "organization", object: project },
			{ user: workspace, relation: "workspace", object: project },
			{ user: organization, relation: "organization", object: team },
		];
		for (const entry of cases) {
			const actor = `${entry.service ? "service_account" : "user"}:${entry.id}`;
			tuples.push({ user: actor, relation: "member", object: organization });
			if (entry.role && entry.role !== "member")
				tuples.push({
					user: actor,
					relation: entry.role,
					object: organization,
				});
		}
		const direct = (
			id: string,
			relation: string,
			object = project,
			service = false,
		) =>
			tuples.push({
				user: `${service ? "service_account" : "user"}:${id}`,
				relation,
				object,
			});
		direct("owner", "denied");
		direct("admin", "denied");
		direct("viewer", "viewer");
		direct("editor", "editor");
		direct("manager", "manager");
		direct("team-reader", "member", team);
		tuples.push({
			user: `${team}#member`,
			relation: "viewer",
			object: project,
		});
		direct("inherited-viewer", "viewer", workspace);
		direct("inherited-editor", "editor", workspace);
		direct("inherited-manager", "manager", workspace);
		direct("denied-viewer", "viewer");
		direct("denied-viewer", "denied");
		direct("denied-inheritance", "manager", workspace);
		direct("denied-inheritance", "denied");
		direct("service-reader", "viewer", project, true);
		direct("service-editor", "editor", workspace, true);
		await fgaRequest(
			f.installation.env.OPENFGA_API_URL,
			`/stores/${publication.storeId}/write`,
			{
				authorization_model_id: publication.modelId,
				writes: { tuple_keys: tuples },
			},
		);
		for (const entry of cases) {
			for (const permission of ["read", "update", "manage"] as const) {
				const contextual = compileResourceContext({
					organizationId: "parity",
					epoch: publication.epoch,
					actorId: entry.id,
					actorType: entry.service ? "service_account" : "user",
					role: entry.role,
					creator: false,
					target: { type: "project", id: "project" },
					workspaceId: "workspace",
					grants: entry.grants,
				});
				const stored = await fgaRequest<{ allowed: boolean }>(
					f.installation.env.OPENFGA_API_URL,
					`/stores/${publication.storeId}/check`,
					{
						authorization_model_id: publication.modelId,
						tuple_key: {
							user: contextual.actor,
							relation: `can_${permission}`,
							object: project,
						},
						consistency: "HIGHER_CONSISTENCY",
					},
				);
				expect(stored.allowed, `${entry.id}:${permission} stored`).toBe(
					entry[permission],
				);
				expect(
					await checkContext(
						f.installation.env.OPENFGA_API_URL,
						publication.storeId,
						publication.modelId,
						contextual,
						permission,
					),
					`${entry.id}:${permission} contextual`,
				).toBe(stored.allowed);
			}
		}
	});
});

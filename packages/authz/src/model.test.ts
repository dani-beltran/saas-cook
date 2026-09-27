import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import {
	authorizationModel,
	compileResourceContext,
	modelHash,
	phase2ModelHash,
	phase3ModelHash,
} from "./model";

const context = {
	organizationId: "organization",
	epoch: "epoch",
	actorId: "member",
	actorType: "user" as const,
	role: "member" as const,
	creator: true,
	target: { type: "project" as const, id: "project" },
	grants: [{ resourceId: "project", relation: "viewer" as const }],
};

describe("direct Project model compatibility", () => {
	it.each([
		["phase2", phase2ModelHash],
		["phase3", phase3ModelHash],
	])("retains the immutable published %s model", async (release, hash) => {
		const predecessor: unknown = JSON.parse(
			await readFile(
				new URL(`./fixtures/${release}-model.json`, import.meta.url),
				"utf8",
			),
		);
		expect(
			createHash("sha256").update(JSON.stringify(predecessor)).digest("hex"),
		).toBe(hash);
		expect(hash).not.toBe(modelHash);
	});
	it("rejects retired targets and parent inputs instead of ignoring them", () => {
		const obsoleteParent = { ...context, workspaceId: "old-parent" };
		expect(() => compileResourceContext(obsoleteParent)).toThrow(
			"Unsupported authorization target",
		);
		expect(() =>
			compileResourceContext({
				...context,
				// @ts-expect-error An old runtime caller must fail closed too.
				target: { type: "workspace", id: "old-parent" },
			}),
		).toThrow("Unsupported authorization target");
		expect(() =>
			compileResourceContext({
				...context,
				target: {
					type: "organization",
					id: "organization",
					// @ts-expect-error Removed service-principal scope target.
					resourceType: "workspace",
				},
			}),
		).toThrow("Unsupported authorization target");
		expect(() =>
			compileResourceContext({
				...context,
				grants: [{ resourceId: "old-parent", relation: "manager" }],
			}),
		).toThrow("Unsupported grant target");
	});
	it("publishes no retired resource, relation or move permission", () => {
		expect(JSON.stringify(authorizationModel)).not.toMatch(
			/workspace|can_move/,
		);
		const compiled = compileResourceContext(context);
		expect(compiled.tuples.some((tuple) => tuple.relation === "viewer")).toBe(
			true,
		);
		expect(
			compiled.tuples.filter((tuple) => tuple.relation === "organization"),
		).toHaveLength(1);
	});
});

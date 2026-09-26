import { describe, expect, it } from "vitest";
import { ParentMoveWorkload } from "./parent-moves";

describe("benchmark parent changes", () => {
	it("changes parents on repeated moves with the 50-client operation schedule", async () => {
		const workload = new ParentMoveWorkload();
		const storedParents = new Map<string, string>();
		const destinations = new Set<string>();
		let moves = 0;
		for (let client = 0; client < 50; client++) {
			let sequence = client;
			let random = client + 1701;
			for (let iteration = 0; iteration < 1000; iteration++) {
				random ^= random << 13;
				random ^= random >>> 17;
				random ^= random << 5;
				const tenant = (random >>> 0) % 10 < 8 ? 0 : 1 + ((random >>> 8) % 99);
				const slot = sequence++ % 10;
				if (slot !== 9 || sequence % 3 !== 0) continue;
				const id = `${tenant}/${client}`;
				await workload.move(id, ["first", "second"], true, async (parent) => {
					// A separate simulated store detects repeated same-parent requests.
					expect(parent).not.toBe(storedParents.get(id));
					storedParents.set(id, parent);
					destinations.add(parent);
					return { id, workspaceId: parent };
				});
				moves++;
			}
		}
		expect(moves).toBe(1660);
		expect(destinations).toEqual(new Set(["first", "second"]));
		expect(workload.evidence(moves)).toMatchObject({
			valid: true,
			verifiedChanges: moves,
			initialAssignments: storedParents.size,
			betweenWorkspaces: moves - storedParents.size,
		});
	});

	it("carries warm-up parents into measurement without counting warm-up moves", async () => {
		const workload = new ParentMoveWorkload();
		const destinations: string[] = [];
		const perform = async (workspaceId: string) => {
			destinations.push(workspaceId);
			return { id: "project", workspaceId, version: destinations.length + 1 };
		};
		await workload.move("project", ["first", "second"], false, perform);
		await workload.move("project", ["first", "second"], true, perform);
		const result = await workload.move(
			"project",
			["first", "second"],
			true,
			perform,
		);
		expect(destinations).toEqual(["first", "second", "first"]);
		expect(result.version).toBe(4);
		expect(workload.evidence(2)).toEqual({
			valid: true,
			verifiedChanges: 2,
			initialAssignments: 0,
			betweenWorkspaces: 2,
			toFirstWorkspace: 1,
			toSecondWorkspace: 1,
			invalidMoves: 0,
		});
		expect(workload.evidence(3).valid).toBe(false);
	});

	it("does not advance or count a failed API operation", async () => {
		const workload = new ParentMoveWorkload();
		const perform = async (workspaceId: string) => ({
			id: "project",
			workspaceId,
		});
		await workload.move("project", ["first", "second"], false, perform);
		await expect(
			workload.move("project", ["first", "second"], true, async () => {
				throw new Error("Synthetic API failure");
			}),
		).rejects.toThrow("Synthetic API failure");
		const result = await workload.move(
			"project",
			["first", "second"],
			true,
			perform,
		);
		expect(result.workspaceId).toBe("second");
		expect(workload.evidence(1)).toMatchObject({
			verifiedChanges: 1,
			invalidMoves: 0,
		});
	});

	it.each([
		{ id: "project", workspaceId: "first" },
		{ id: "wrong-project", workspaceId: "second" },
	])("invalidates a run after a bad warm-up response: %j", async (response) => {
		const workload = new ParentMoveWorkload();
		const perform = async (workspaceId: string) => ({
			id: "project",
			workspaceId,
		});
		await workload.move("project", ["first", "second"], false, perform);
		await expect(
			workload.move(
				"project",
				["first", "second"],
				false,
				async () => response,
			),
		).rejects.toThrow("did not confirm");
		await workload.move("project", ["first", "second"], true, perform);
		await workload.move("project", ["first", "second"], true, perform);
		expect(workload.evidence(2)).toMatchObject({
			valid: false,
			verifiedChanges: 2,
			invalidMoves: 1,
		});
	});

	it("rejects identical workspace fixtures before calling the API", async () => {
		const workload = new ParentMoveWorkload();
		let called = false;
		await expect(
			workload.move("project", ["same", "same"], true, async (workspaceId) => {
				called = true;
				return { id: "project", workspaceId };
			}),
		).rejects.toThrow("must change");
		expect(called).toBe(false);
		expect(workload.evidence(0)).toMatchObject({
			valid: false,
			invalidMoves: 1,
		});
	});

	it("does not accept an empty workload or initial assignments alone", async () => {
		const workload = new ParentMoveWorkload();
		expect(workload.evidence(0).valid).toBe(false);
		await workload.move(
			"project",
			["first", "second"],
			true,
			async (parent) => ({
				id: "project",
				workspaceId: parent,
			}),
		);
		expect(workload.evidence(1).valid).toBe(false);
	});
});

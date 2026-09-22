import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
	fixtureTuples,
	qualifyObject,
	qualifyTuples,
	type Tuple,
} from "./model.js";
import {
	type Attempt,
	type Authority,
	canPublish,
	checkAt,
	Fence,
	type Graph,
	newAttempt,
	project,
	type Revision,
} from "./protocol.js";

class MemoryAuthority implements Authority {
	revision: Revision = {
		organization: "t",
		desired: 1,
		applied: 0,
		generation: "",
		epoch: randomUUID(),
		model: "model1",
		ready: true,
	};
	source = fixtureTuples("t", 3);
	attempts = new Map<string, Attempt>();
	fence = new Fence();
	async prepare(organization: string, id: string): Promise<Attempt> {
		return this.fence.run(true, async () => {
			for (const attempt of this.attempts.values())
				if (["building", "verified"].includes(attempt.state))
					attempt.state = "abandoned";
			const attempt = newAttempt(organization, id, this.revision, this.source);
			this.attempts.set(id, attempt);
			return attempt;
		});
	}
	async acknowledge(attempt: Attempt): Promise<void> {
		if (attempt.state !== "building") throw new Error("abandoned");
		attempt.state = "verified";
	}
	async publish(attempt: Attempt): Promise<boolean> {
		return this.fence.run(true, async () => {
			if (!canPublish(attempt, this.revision)) {
				if (attempt.state !== "active") attempt.state = "abandoned";
				return false;
			}
			for (const old of this.attempts.values())
				if (old.state === "active") old.state = "retired";
			attempt.state = "active";
			this.revision.applied = attempt.revision;
			this.revision.generation = attempt.generation;
			return true;
		});
	}
	async abandon(attempt: Attempt): Promise<void> {
		if (["building", "verified"].includes(attempt.state))
			attempt.state = "abandoned";
	}
	async revoke(): Promise<void> {
		await this.fence.run(true, async () => {
			this.source = this.source.filter(
				(tuple) => !(tuple.user === "user:t-u1" && tuple.relation === "viewer"),
			);
			this.revision.desired++;
		});
	}
	async read(graph: Graph, user = "user:t-u1"): Promise<boolean> {
		return this.fence.run(false, () =>
			checkAt(graph, this.revision, user, "project:r000000"),
		);
	}
}

class MemoryGraph implements Graph {
	tuples = new Map<string, Tuple>();
	outage = false;
	async write(tuples: readonly Tuple[]): Promise<void> {
		if (this.outage) throw new Error("FGA unavailable");
		for (const tuple of tuples) this.tuples.set(JSON.stringify(tuple), tuple);
	}
	async remove(tuples: readonly Tuple[]): Promise<void> {
		for (const tuple of tuples) this.tuples.delete(JSON.stringify(tuple));
	}
	async check(
		user: string,
		relation: string,
		object: string,
	): Promise<boolean> {
		if (this.outage) throw new Error("FGA unavailable");
		const tuples = [...this.tuples.values()];
		const direct = async (name: string) => {
			for (const tuple of tuples.filter(
				(candidate) =>
					candidate.object === object && candidate.relation === name,
			)) {
				if (
					tuple.condition &&
					Date.parse(tuple.condition.context.expires_at) <= Date.now()
				)
					continue;
				if (tuple.user === user) return true;
				const [target, userset] = tuple.user.split("#");
				if (target && userset && (await this.check(user, userset, target)))
					return true;
			}
			return false;
		};
		if (!["can_read", "can_manage"].includes(relation)) return direct(relation);
		const organization = tuples.find(
			(tuple) => tuple.object === object && tuple.relation === "organization",
		)?.user;
		if (!organization || !(await this.check(user, "member", organization)))
			return false;
		if (
			(await this.check(user, "admin", organization)) ||
			(await direct("manager"))
		)
			return true;
		if (relation === "can_manage") return false;
		if (await direct("viewer")) return true;
		const parent = tuples.find(
			(tuple) => tuple.object === object && tuple.relation === "parent",
		)?.user;
		return parent ? this.check(user, "can_read", parent) : false;
	}
}

function deferred() {
	let resolve!: () => void;
	const promise = new Promise<void>((done) => {
		resolve = done;
	});
	return { promise, resolve };
}

describe("generation protocol model (not a service benchmark)", () => {
	it("isolates the exact lost-connection, N replay, N+1 revoke, late N write sequence", async () => {
		const authority = new MemoryAuthority();
		const graph = new MemoryGraph();
		const release = deferred();
		let oldWrite: Promise<void> | undefined;
		const lateGraph: Graph = {
			write: (tuples) => {
				oldWrite = release.promise.then(() => graph.write(tuples));
				return oldWrite;
			},
			remove: (tuples) => graph.remove(tuples),
			check: (user, relation, object) => graph.check(user, relation, object),
		};
		await expect(
			project(authority, lateGraph, "t", { timeoutMs: 5 }),
		).rejects.toThrow("remote_timeout");
		const abandoned = [...authority.attempts.values()][0];
		expect(abandoned?.state).toBe("abandoned");
		if (!abandoned) throw new Error("Missing abandoned attempt");
		await project(authority, graph, "t"); // B recovers revision N.
		expect(await authority.read(graph)).toBe(true);
		await authority.revoke();
		await expect(authority.read(graph)).rejects.toThrow("projection_pending");
		await project(authority, graph, "t"); // B applies revision N+1.
		release.resolve();
		await oldWrite;
		expect(authority.revision.desired).toBe(authority.revision.applied);
		expect(await authority.read(graph)).toBe(false);
		expect(await authority.publish(abandoned)).toBe(false);
		expect(
			await graph.check(
				"user:t-u1",
				"can_read",
				qualifyObject("project:r000000", abandoned),
			),
		).toBe(true);
	});

	it("prevents duplicate workers from publishing abandoned or stale snapshots", async () => {
		const authority = new MemoryAuthority();
		const a = await authority.prepare("t", randomUUID());
		const b = await authority.prepare("t", randomUUID());
		await expect(authority.acknowledge(a)).rejects.toThrow("abandoned");
		await authority.acknowledge(b);
		await authority.revoke();
		expect(await authority.publish(b)).toBe(false);
		expect(authority.revision.generation).toBe("");
	});

	it("qualifies organization, parent and team usersets in one namespace", async () => {
		const authority = new MemoryAuthority();
		authority.source.push({
			user: "workspace:a",
			relation: "parent",
			object: "project:r000001",
		});
		const graph = new MemoryGraph();
		const result = await project(authority, graph, "t");
		for (const tuple of result.attempt.tuples) {
			expect(tuple.object).toContain(`/${result.attempt.generation}/`);
			if (!tuple.user.startsWith("user:"))
				expect(tuple.user).toContain(`/${result.attempt.generation}/`);
		}
		expect(
			await checkAt(graph, authority.revision, "user:t-u2", "project:r000001"),
		).toBe(true);
		expect(
			await checkAt(
				graph,
				authority.revision,
				"user:other-u2",
				"project:r000001",
			),
		).toBe(false);
	});

	it("denies during outage and recovers only after acknowledged projection", async () => {
		const authority = new MemoryAuthority();
		const graph = new MemoryGraph();
		await project(authority, graph, "t");
		graph.outage = true;
		await authority.revoke(); // Trusted negative change does not consult FGA.
		await expect(project(authority, graph, "t")).rejects.toThrow(
			"FGA unavailable",
		);
		await expect(authority.read(graph)).rejects.toThrow("projection_pending");
		graph.outage = false;
		await project(authority, graph, "t");
		expect(await authority.read(graph)).toBe(false);
		expect(await authority.read(graph, "user:t-u0")).toBe(true);
	});

	it("fences old epochs/models and does not release recovery by revision equality", async () => {
		const authority = new MemoryAuthority();
		const graph = new MemoryGraph();
		const old = await authority.prepare("t", randomUUID());
		await authority.acknowledge(old);
		authority.revision.epoch = randomUUID();
		authority.revision.ready = false;
		expect(await authority.publish(old)).toBe(false);
		await project(authority, graph, "t");
		await expect(authority.read(graph)).rejects.toThrow("recovery_pending");
		const candidate = await authority.prepare("t", randomUUID());
		await authority.acknowledge(candidate);
		authority.revision.model = "model2";
		expect(await authority.publish(candidate)).toBe(false);
	});

	it("denies expired grants without waiting for cleanup", async () => {
		const authority = new MemoryAuthority();
		authority.source = authority.source.filter(
			(tuple) => tuple.relation !== "viewer" || tuple.user !== "user:t-u1",
		);
		authority.source.push({
			user: "user:t-u1",
			relation: "viewer",
			object: "project:r000000",
			condition: {
				name: "before_expiry",
				context: { expires_at: "2000-01-01T00:00:00Z" },
			},
		});
		const graph = new MemoryGraph();
		await project(authority, graph, "t");
		expect(await authority.read(graph)).toBe(false);
	});

	it("does not starve a revocation behind newly arriving sparse readers", async () => {
		const fence = new Fence(1_000);
		const release = deferred();
		const order: string[] = [];
		const read = fence.run(false, () => release.promise);
		const revoke = fence.run(true, async () => {
			order.push("revoke");
		});
		const list = fence.run(false, async () => {
			order.push("list");
		});
		release.resolve();
		await Promise.all([read, revoke, list]);
		expect(order).toEqual(["revoke", "list"]);
	});

	it("bounds queued waiters and lock time", async () => {
		const fence = new Fence(10, 1);
		const release = deferred();
		const held = fence.run(true, () => release.promise);
		const waiting = fence.run(true, async () => undefined);
		await expect(fence.run(false, async () => undefined)).rejects.toThrow(
			"queue_full",
		);
		await expect(waiting).rejects.toThrow("lock_timeout");
		release.resolve();
		await held;
	});

	it("cleanup cannot erase the active generation, and late recreated tuples remain unreachable", async () => {
		const authority = new MemoryAuthority();
		const graph = new MemoryGraph();
		const old = (await project(authority, graph, "t")).attempt;
		await authority.revoke();
		await project(authority, graph, "t");
		expect(old.state).toBe("retired");
		await graph.remove(old.tuples);
		await graph.write(old.tuples);
		expect(await authority.read(graph)).toBe(false);
		expect(await authority.read(graph, "user:t-u0")).toBe(true);
	});

	it("takes a fixed snapshot before remote writes", async () => {
		const authority = new MemoryAuthority();
		const condition = {
			name: "before_expiry",
			context: { expires_at: "2030-01-01T00:00:00Z" },
		};
		authority.source.push({
			user: "user:t-u3",
			relation: "viewer",
			object: "project:r000000",
			condition,
		});
		const attempt = await authority.prepare("t", randomUUID());
		const before = structuredClone(attempt.tuples);
		condition.context.expires_at = "2000-01-01T00:00:00Z";
		await authority.revoke();
		expect(attempt.tuples).toEqual(before);
		expect(qualifyTuples(authority.source, attempt)).not.toEqual(before);
		expect(() =>
			qualifyObject("team:t/old-generation/editors", attempt),
		).toThrow("Invalid source object");
	});
});

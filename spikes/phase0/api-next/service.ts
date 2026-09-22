import { ORPCError } from "@orpc/server";
import type { z } from "zod";
import type { projectDto } from "./contracts";

type Project = z.infer<typeof projectDto> & { internalSecret: string };
export type Actor = {
	userId: string;
	organizationId: string;
	writable: boolean;
};
export type Context = { actor: Actor | null; requestId: string };

// Deliberately synthetic: no production authentication, persistence or ReBAC claim.
export class ProjectFixtureService {
	private projects = new Map<string, Project>([
		[
			"alpha:p1",
			{
				id: "p1",
				organizationId: "alpha",
				name: "Alpha",
				version: 1,
				internalSecret: "never-a-DTO",
			},
		],
		[
			"beta:p2",
			{
				id: "p2",
				organizationId: "beta",
				name: "Beta",
				version: 1,
				internalSecret: "never-a-DTO",
			},
		],
	]);
	private receipts = new Map<string, { hash: string; result: Project }>();
	private authorized(
		context: Context,
		organizationId: string,
		id: string,
		write = false,
	) {
		if (!context.actor)
			throw new ORPCError("UNAUTHORIZED", {
				data: { requestId: context.requestId },
			});
		if (
			context.actor.organizationId !== organizationId ||
			(write && !context.actor.writable)
		)
			throw new ORPCError("FORBIDDEN", {
				data: { requestId: context.requestId },
			});
		const project = this.projects.get(`${organizationId}:${id}`);
		if (!project)
			throw new ORPCError("NOT_FOUND", {
				data: { requestId: context.requestId },
			});
		return project;
	}
	read(context: Context, input: { organizationId: string; id: string }) {
		return this.authorized(context, input.organizationId, input.id);
	}
	update(
		context: Context,
		input: {
			organizationId: string;
			id: string;
			name: string;
			version: number;
			idempotencyKey: string;
		},
	) {
		const project = this.authorized(
			context,
			input.organizationId,
			input.id,
			true,
		);
		const key = `${context.actor!.userId}:${input.organizationId}:${input.id}:${input.idempotencyKey}`;
		const hash = JSON.stringify([input.name, input.version]);
		const receipt = this.receipts.get(key);
		if (receipt) {
			if (receipt.hash !== hash)
				throw new ORPCError("CONFLICT", {
					data: { requestId: context.requestId },
				});
			return receipt.result;
		}
		if (project.version !== input.version)
			throw new ORPCError("CONFLICT", {
				data: { requestId: context.requestId },
			});
		const result = {
			...project,
			name: input.name,
			version: project.version + 1,
		};
		this.projects.set(`${input.organizationId}:${input.id}`, result);
		this.receipts.set(key, { hash, result });
		return result;
	}
}

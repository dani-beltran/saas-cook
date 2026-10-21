import * as ts from "typescript/unstable/ast";
import { createVirtualFileSystem } from "typescript/unstable/fs";
import { API } from "typescript/unstable/sync";
import { z } from "zod";
import { contract } from "../../packages/api-contracts/src/index";

const internalFields = new Set([
	"secretHash",
	"secret_hash",
	"tokenHash",
	"token_hash",
	"encryptedPayload",
	"encrypted_payload",
	"authorizationRevision",
	"authorization_revision",
	"recoveryEpoch",
	"recovery_epoch",
	"credentialEpoch",
	"credential_epoch",
	"password",
	"accessToken",
	"refreshToken",
	"internalNotes",
]);
const serverFields = new Set([
	...internalFields,
	"actorId",
	"actor_id",
	"createdAt",
	"created_at",
	"updatedAt",
	"updated_at",
	"deletedAt",
	"deleted_at",
	"ownerMembershipId",
	"owner_membership_id",
]);

/** Inspect the executable schemas, including nested DTOs and discriminated commands. */
export function checkContracts(tree: unknown = contract): string[] {
	const failures: string[] = [];
	function schema(
		value: unknown,
		location: string,
		input: boolean,
		boundedAfter = false,
	) {
		if (!(value instanceof z.ZodType)) {
			failures.push(`${location}: missing executable Zod schema`);
			return;
		}
		if (value instanceof z.ZodObject) {
			const catchall = value.def.catchall;
			if (input && !(catchall instanceof z.ZodNever))
				failures.push(`${location}: input must reject unknown fields`);
			if (!input && catchall && !(catchall instanceof z.ZodNever))
				failures.push(`${location}: DTO must not forward unknown fields`);
			for (const [key, child] of Object.entries(value.shape)) {
				if ((input ? serverFields : internalFields).has(key))
					failures.push(
						`${location}.${key}: internal/server-owned field exposed`,
					);
				if (
					input &&
					location.endsWith("create.input") &&
					["id", "version"].includes(key)
				)
					failures.push(
						`${location}.${key}: create cannot assign server identity/version`,
					);
				schema(child, `${location}.${key}`, input);
			}
		} else if (value instanceof z.ZodArray) {
			schema(value.element, `${location}[]`, input);
		} else if (value instanceof z.ZodUnion) {
			for (const option of value.options) schema(option, location, input);
		} else if (value instanceof z.ZodIntersection) {
			schema(value.def.left, location, input);
			schema(value.def.right, location, input);
		} else if (value instanceof z.ZodTuple) {
			for (const [index, item] of value.def.items.entries())
				schema(item, `${location}[${index}]`, input);
			if (value.def.rest) schema(value.def.rest, `${location}[]`, input);
		} else if (
			value instanceof z.ZodOptional ||
			value instanceof z.ZodNullable ||
			value instanceof z.ZodReadonly ||
			value instanceof z.ZodPrefault
		) {
			schema(value.unwrap(), location, input, boundedAfter);
		} else if (value instanceof z.ZodPipe) {
			// A transform has no inspectable output allowlist. Require a subsequent
			// executable schema; inspecting only its input silently misses leaked fields.
			schema(value.in, location, input, true);
			schema(value.out, location, input, boundedAfter);
		} else if (value instanceof z.ZodTransform) {
			if (!boundedAfter)
				failures.push(
					`${location}: transform requires a bounded output schema`,
				);
		} else if (["any", "unknown", "record"].includes(value.def.type)) {
			failures.push(
				`${location}: unbounded schema defeats the field allowlist`,
			);
		} else if (
			![
				"string",
				"number",
				"boolean",
				"enum",
				"literal",
				"null",
				"undefined",
				"void",
				"never",
			].includes(value.def.type)
		) {
			// Lazy/custom schemas and unparsed catch/default fallbacks need explicit
			// review; do not silently accept an unfamiliar container or output shape.
			failures.push(`${location}: unsupported ${value.def.type} schema`);
		}
	}
	function walk(value: unknown, location: string) {
		if (typeof value !== "object" || value === null) {
			failures.push(`${location}: invalid contract registration`);
			return;
		}
		if ("~orpc" in value) {
			const definition = value["~orpc"] as {
				inputSchema?: unknown;
				outputSchema?: unknown;
			};
			schema(definition.inputSchema, `${location}.input`, true);
			schema(definition.outputSchema, `${location}.output`, false);
			return;
		}
		for (const [key, child] of Object.entries(value))
			walk(child, location ? `${location}.${key}` : key);
	}
	walk(tree, "");
	return failures;
}

// Exact reviewed legacy adapters: each owns session resolution and lifecycle fences.
const adapters: Record<string, string> = {
	"organizations.summary": "readOrganizationSummary",
	"organizations.list": "listOrganizations",
	"organizations.create": "createOrganization",
	"organizations.get": "readOrganization",
	"organizations.command": "organizationCommand",
	"diagnostics.echo": "echoDiagnostic",
	// Capability receipts can only read deletion status or suppress optional email.
	"privacy.deletionStatus": "publicOperation",
	"notifications.unsubscribe": "publicOperation",
};

/** AST validation is supplemental; the command also executes the actual transport/service tests. */
export function checkRouteCapabilities(source: string): string[] {
	// TypeScript 7 ships its parser through the pinned native API.
	const api = new API({
		cwd: "/phase4",
		fs: createVirtualFileSystem({
			"/phase4/tsconfig.json": JSON.stringify({
				compilerOptions: { noLib: true, noResolve: true },
				files: ["router.ts"],
			}),
			"/phase4/router.ts": source,
		}),
	});
	try {
		const snapshot = api.updateSnapshot({
			openProjects: ["/phase4/tsconfig.json"],
		});
		const file = snapshot
			.getProject("/phase4/tsconfig.json")
			?.program.getSourceFile("/phase4/router.ts");
		if (!file) return ["API router could not be parsed"];
		const failures: string[] = [];
		let registrations = 0;
		function object(node: ts.ObjectLiteralExpression, prefix: string) {
			for (const member of node.properties) {
				if (
					!ts.isPropertyAssignment(member) ||
					!member.name ||
					!ts.isIdentifier(member.name)
				) {
					failures.push(
						`${prefix}: router registrations must be explicit properties`,
					);
					continue;
				}
				const location = prefix
					? `${prefix}.${member.name.text}`
					: member.name.text;
				if (ts.isObjectLiteralExpression(member.initializer)) {
					object(member.initializer, location);
					continue;
				}
				registrations++;
				const handler = member.initializer;
				const callback = ts.isCallExpression(handler)
					? handler.arguments[0]
					: undefined;
				const body =
					callback && ts.isArrowFunction(callback) ? callback.body : undefined;
				if (
					!body ||
					!ts.isCallExpression(body) ||
					!ts.isIdentifier(body.expression)
				) {
					failures.push(
						`${location}: handler must enter a reviewed permission boundary directly`,
					);
					continue;
				}
				const boundary = body.expression.text;
				if (adapters[location] === boundary || boundary === "humanOperation")
					continue;
				if (boundary !== "resourceOperation") {
					failures.push(`${location}: missing permission boundary`);
					continue;
				}
				const capability = body.arguments[2];
				const fields = new Map<string, ts.SyntaxKind>();
				if (capability && ts.isObjectLiteralExpression(capability)) {
					for (const property of capability.properties) {
						if (
							!ts.isPropertyAssignment(property) ||
							!ts.isIdentifier(property.name) ||
							!["mutate", "serviceAccounts"].includes(property.name.text)
						) {
							failures.push(
								`${location}: capability must contain only explicit known properties`,
							);
							continue;
						}
						const name = property.name.text;
						if (fields.has(name))
							failures.push(`${location}: duplicate ${name} capability`);
						fields.set(name, property.initializer.kind);
					}
				}
				for (const name of ["mutate", "serviceAccounts"])
					if (
						![ts.SyntaxKind.TrueKeyword, ts.SyntaxKind.FalseKeyword].includes(
							fields.get(name) ?? ts.SyntaxKind.Unknown,
						)
					)
						failures.push(`${location}: explicit ${name} capability required`);
			}
		}
		function visit(node: ts.Node) {
			if (
				ts.isCallExpression(node) &&
				ts.isPropertyAccessExpression(node.expression) &&
				node.expression.name.text === "router"
			) {
				const registration = node.arguments[0];
				if (registration && ts.isObjectLiteralExpression(registration))
					object(registration, "");
			}
			node.forEachChild(visit);
		}
		visit(file);
		if (registrations === 0)
			failures.push("No explicit API router registrations found");
		return failures;
	} finally {
		api.close();
	}
}

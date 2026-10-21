import { expect, it } from "vitest";
import { fileMetadata, uploadInput } from "../files";
import { analyticsPreferenceInput } from "./analytics";
import { publicId } from "./common";
import { bulkInput } from "./data-jobs";
import {
	auditQuery,
	integrationCommandInput,
	webhookInput,
} from "./organization-settings";
import { deletionRequestInput, deletionStatusInput } from "./privacy";

const id = "12345678-1234-4234-8234-123456789abc";
const key = "operation-123";
it("rejects UUID lookalikes accepted by the old route guard", () => {
	for (const value of [
		"-".repeat(36),
		"a".repeat(36),
		"12345678-1234-1234-1234-123456789abc",
	])
		expect(publicId.safeParse(value).success).toBe(false);
	expect(publicId.safeParse(id.toUpperCase()).success).toBe(true);
});
it("retains bulk cross-field checks when route context is composed into the schema", () => {
	const request = bulkInput.safeExtend({ organizationId: publicId });
	const valid = {
		organizationId: id,
		kind: "projects.import",
		operationKey: key,
		projectId: id,
		fileId: id,
		mapping: { name: "Name", slug: "Slug" },
		duplicates: "reject",
	};
	expect(request.parse(valid)).toEqual(valid);
	for (const field of [
		"projectId",
		"fileId",
		"mapping",
		"duplicates",
	] as const) {
		expect(request.safeParse({ ...valid, [field]: undefined }).success).toBe(
			false,
		);
		expect(
			request.safeParse({
				organizationId: id,
				kind: "projects.export",
				operationKey: key,
				[field]: valid[field],
			}).success,
		).toBe(false);
	}
	expect(request.safeParse({ ...valid, actorId: id }).success).toBe(false);
	expect(
		bulkInput.safeParse({ kind: "projects.export", operationKey: key }).success,
	).toBe(true);
});
it("checks file metadata before reading bytes with the same constraints as initiation", () => {
	const metadata = {
		name: "report.csv",
		contentType: "text/csv",
		bytes: 1048576,
	};
	expect(fileMetadata.parse(metadata)).toEqual(metadata);
	for (const patch of [
		{ bytes: 0 },
		{ bytes: 1048577 },
		{ name: "report.exe" },
		{ name: "../report.csv" },
		{ name: `${"x".repeat(120)}.csv` },
		{ contentType: "text/html" },
	]) {
		const input = { ...metadata, ...patch };
		expect(fileMetadata.safeParse(input).success).toBe(false);
		expect(
			uploadInput.safeParse({
				...input,
				projectId: id,
				operationKey: key,
				sha256: "a".repeat(64),
			}).success,
		).toBe(false);
	}
});
it("normalizes endpoint names and retains strict input and rotation requirements", () => {
	const endpoint = {
		name: "  Endpoint  ",
		url: "https://hooks.example.test",
		events: ["project.created"],
		operationKey: key,
	};
	expect(webhookInput.parse(endpoint).name).toBe("Endpoint");
	expect(
		webhookInput.safeParse({ ...endpoint, secret: "forged" }).success,
	).toBe(false);
	const command = { id, version: 0, operationKey: key, action: "rotate" };
	expect(integrationCommandInput.safeParse(command).success).toBe(false);
	expect(
		integrationCommandInput
			.safeExtend({ organizationId: publicId })
			.safeParse({ ...command, organizationId: id }).success,
	).toBe(false);
	expect(
		integrationCommandInput.safeParse({ ...command, token: "x".repeat(16) })
			.success,
	).toBe(true);
	expect(auditQuery.parse({ limit: "50" })).toEqual({ limit: 50 });
	expect(auditQuery.safeParse({ limit: 51 }).success).toBe(false);
});
it("retains deletion key/receipt syntax and rejects missing organization references", () => {
	expect(
		deletionRequestInput.safeParse({ kind: "account", operationKey: key })
			.success,
	).toBe(true);
	expect(
		deletionRequestInput.safeParse({ kind: "organization", operationKey: key })
			.success,
	).toBe(false);
	expect(
		deletionRequestInput.safeParse({
			kind: "account",
			operationKey: "invalid key",
		}).success,
	).toBe(false);
	expect(
		deletionStatusInput.safeParse({ id, receipt: "x".repeat(43) }).success,
	).toBe(true);
	expect(
		deletionStatusInput.safeParse({ id, receipt: "!".repeat(43) }).success,
	).toBe(false);
	expect(
		analyticsPreferenceInput.safeParse({
			enabled: true,
			version: Number.MAX_SAFE_INTEGER + 1,
		}).success,
	).toBe(false);
});

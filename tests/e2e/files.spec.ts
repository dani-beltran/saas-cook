import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { expect, test } from "@playwright/test";
import {
	type CustomerFixtureEnv,
	customerFixtureRuntime,
} from "../../packages/testing/src/example-customers/fixture";

test("Project text uploads verify immutable bytes and download through a current session", async ({
	page,
	baseURL,
}, info) => {
	const runtime = customerFixtureRuntime(
		process.env as CustomerFixtureEnv,
		baseURL ?? "http://localhost:3102",
	);
	try {
		const owner = await runtime.human(`files-${randomUUID()}@example.test`);
		const org = await runtime.tenancy.createOrganization(owner.actor, {
			name: "Files studio",
			slug: `files-${randomUUID()}`,
			operationKey: randomUUID(),
		});
		await page.context().addCookies(
			owner.cookie.split("; ").map((item) => {
				const i = item.indexOf("=");
				return {
					name: item.slice(0, i),
					value: item.slice(i + 1),
					url: runtime.origin,
				};
			}),
		);
		const response = await page.request.post(
			`/api/v1/organizations/${org.id}/projects`,
			{
				headers: { origin: runtime.origin },
				data: {
					name: "File project",
					slug: "file-project",
					operationKey: randomUUID(),
				},
			},
		);
		expect(response.ok()).toBe(true);
		await page.goto(`/en/organizations/${org.id}/projects`);
		await page.getByRole("button", { name: "Edit", exact: true }).click();
		const region = page.getByRole("region", { name: "Files", exact: true });
		await expect(region).toContainText("No files");
		const contents = Buffer.from("Verified text\n");
		await region.getByLabel("Choose file").setInputFiles({
			name: "receipt.txt",
			mimeType: "text/plain",
			buffer: contents,
		});
		await region.getByRole("button", { name: "Upload and verify" }).click();
		await expect(
			region.getByRole("button", { name: "Download", exact: true }),
		).toBeVisible();
		await expect(region).toContainText("Ready");
		const pending = page.waitForEvent("download");
		await region.getByRole("button", { name: "Download", exact: true }).click();
		const download = await pending;
		expect(download.suggestedFilename()).toBe("receipt.txt");
		const path = await download.path();
		expect(path).not.toBeNull();
		expect(await readFile(path as string)).toEqual(contents);
		await page.setViewportSize({ width: 390, height: 844 });
		await page.emulateMedia({ colorScheme: "dark" });
		await page.goto(`/es/organizations/${org.id}/projects`);
		await page.getByRole("button", { name: "Editar", exact: true }).click();
		await expect(
			page.getByRole("region", { name: "Archivos", exact: true }),
		).toContainText("receipt.txt");
		expect(
			await page.evaluate(
				() => document.documentElement.scrollWidth <= window.innerWidth,
			),
		).toBe(true);
		await page.screenshot({
			path: info.outputPath("files-mobile-es.png"),
			fullPage: true,
		});
	} finally {
		await runtime.close();
	}
});

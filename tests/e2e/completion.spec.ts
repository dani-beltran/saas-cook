import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { expect, test } from "@playwright/test";
import {
	type CustomerFixtureEnv,
	customerFixtureRuntime,
} from "../../packages/testing/src/example-customers/fixture";

test("data jobs, restricted audit, personal preferences and deletion preparation work with real sessions and worker", async ({
	page,
	baseURL,
}, info) => {
	test.setTimeout(90000);
	const runtime = customerFixtureRuntime(
		process.env as CustomerFixtureEnv,
		baseURL ?? "http://localhost:3102",
	);
	try {
		const owner = await runtime.human(
			`completion-${randomUUID()}@example.test`,
		);
		const org = await runtime.tenancy.createOrganization(owner.actor, {
			name: "Completion studio",
			slug: `completion-${randomUUID()}`,
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
		const created = await page.request.post(
			`/api/v1/organizations/${org.id}/projects`,
			{
				headers: { origin: runtime.origin },
				data: {
					name: "CSV source project",
					slug: "csv-source",
					operationKey: randomUUID(),
				},
			},
		);
		expect(created.ok()).toBe(true);
		await page.goto(`/en/organizations/${org.id}/projects`);
		await page.getByRole("button", { name: "Edit", exact: true }).click();
		const files = page.getByRole("region", { name: "Files", exact: true });
		await files.getByLabel("Choose file").setInputFiles({
			name: "projects.csv",
			mimeType: "text/csv",
			buffer: Buffer.from("name,slug\nImported through UI,ui-imported\n"),
		});
		await files.getByRole("button", { name: "Upload and verify" }).click();
		await expect(
			files.getByRole("button", { name: "Download", exact: true }),
		).toBeVisible();
		await page.goto(`/en/organizations/${org.id}/data`);
		await page
			.getByLabel("Source project")
			.selectOption({ label: "CSV source project" });
		await page
			.getByLabel("Verified CSV file")
			.selectOption({ label: "projects.csv" });
		await page.getByRole("button", { name: "Dry run", exact: true }).click();
		await expect(
			page.getByRole("status").filter({ hasText: "rows checked" }),
		).toContainText("1 rows checked");
		await page
			.getByRole("button", { name: "Start import", exact: true })
			.click();
		await expect(
			page.locator(".completion-list").filter({ hasText: "projects.import" }),
		).toContainText("complete", { timeout: 25000 });
		await page
			.getByRole("button", { name: "Projects CSV", exact: true })
			.click();
		const job = page
			.locator(".completion-list li")
			.filter({ hasText: "projects.export" });
		await expect(
			job.getByRole("button", { name: "Download", exact: true }),
		).toBeVisible({ timeout: 25000 });
		const pending = page.waitForEvent("download");
		await job.getByRole("button", { name: "Download", exact: true }).click();
		const downloaded = await pending;
		expect(
			await readFile((await downloaded.path()) as string, "utf8"),
		).toContain("Imported through UI");
		await page.goto(`/en/organizations/${org.id}/settings`);
		await expect(
			page.getByRole("heading", { name: "Restricted audit log" }),
		).toBeVisible();
		await page
			.getByRole("button", { name: "Grant access", exact: true })
			.click();
		await page
			.getByRole("button", { name: "Query audit log", exact: true })
			.click();
		await expect(
			page.getByRole("table", { name: "Security events" }),
		).toBeVisible();
		await page
			.getByLabel("Allow optional analytics for this organization")
			.click();
		await expect(
			page.getByLabel("Allow optional analytics for this organization"),
		).not.toBeChecked();
		await page.goto("/en/privacy");
		await page.getByLabel("Email when data jobs finish").click();
		await expect(page.getByRole("status")).toContainText("Operation completed");
		await page.getByRole("button", { name: "Check ownership" }).click();
		await expect(page.locator("main")).toContainText(
			"Needs successor or deletion",
		);
		await expect(
			page.getByRole("button", { name: "Prepare deletion request" }),
		).toBeDisabled();
		await page.goto(`/en/organizations/${org.id}/privacy`);
		await page
			.getByRole("button", { name: "Prepare deletion request" })
			.click();
		await expect(
			page.getByRole("button", { name: "Confirm deletion", exact: true }),
		).toBeDisabled();
		await page
			.getByRole("button", { name: "Cancel request", exact: true })
			.click();
		await expect(
			page.getByRole("button", { name: "Prepare deletion request" }),
		).toBeVisible();
		await page.setViewportSize({ width: 390, height: 844 });
		await page.emulateMedia({ colorScheme: "dark" });
		await page.goto(`/es/organizations/${org.id}/settings`);
		await expect(
			page.getByRole("heading", { name: "Configuración de la organización" }),
		).toBeVisible();
		expect(
			await page.evaluate(
				() => document.documentElement.scrollWidth <= window.innerWidth,
			),
		).toBe(true);
		await expect(
			page.getByLabel("Permitir analítica opcional de esta organización"),
		).toBeVisible();
		await page.screenshot({
			path: info.outputPath("completion-settings-es-mobile.png"),
			fullPage: true,
		});
		await page.goto("/es/help");
		await expect(
			page.getByRole("heading", { name: "Centro de ayuda" }),
		).toBeVisible();
		await page.goto("/en/about");
		await expect(
			page.getByRole("heading", { name: "SaaS Cook", exact: true }),
		).toBeVisible();
	} finally {
		await runtime.close();
	}
});

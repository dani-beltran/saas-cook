import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { dashboardSignUp } from "./dashboard-helpers";

test("project submissions survive a lost committed response and ignore an older search response", async ({
	page,
	baseURL,
}) => {
	test.setTimeout(120_000);
	const suffix = randomUUID().slice(0, 8);
	await dashboardSignUp(page, `project-retry-${suffix}@example.test`);
	const headers = { origin: baseURL ?? "" };
	const organization = await page.request.post("/api/v1/organizations", {
		headers,
		data: {
			name: "Retry studio",
			slug: `retry-${suffix}`,
			operationKey: randomUUID(),
		},
	});
	expect(organization.status()).toBe(200);
	const { id: organizationId } = await organization.json();
	const endpoint = `/api/v1/organizations/${organizationId}/projects`;
	await page.goto(`/en/organizations/${organizationId}/projects`);
	await expect(
		page.getByText("Loading projects…", { exact: true }),
	).toHaveCount(0);
	await page.getByRole("button", { name: "New project", exact: true }).click();
	const editor = page.getByRole("region", { name: "New project", exact: true });
	await editor
		.getByLabel("Name", { exact: true })
		.fill("Previous query project");
	await editor.getByLabel("Slug", { exact: true }).fill(`previous-${suffix}`);
	await editor
		.getByLabel("Description", { exact: true })
		.fill("Keep this draft when the response is lost.");
	const submissions: unknown[] = [];
	let release = () => {};
	const pending = new Promise<void>((resolve) => {
		release = resolve;
	});
	await page.route("**/api/rpc/projects/create", async (route) => {
		submissions.push(route.request().postDataJSON());
		if (submissions.length === 1) {
			await pending;
			const response = await route.fetch();
			expect(response.status()).toBe(200);
			await route.abort("failed");
		} else await route.fulfill({ response: await route.fetch() });
	});
	await editor
		.getByRole("button", { name: "Create project", exact: true })
		.click();
	await expect(
		editor.getByRole("button", { name: "Saving…", exact: true }),
	).toBeDisabled();
	await expect(editor.locator("form")).toHaveAttribute("aria-busy", "true");
	await editor
		.locator("form")
		.evaluate((form) => (form as HTMLFormElement).requestSubmit());
	await expect.poll(() => submissions.length).toBe(1);
	release();
	await expect(editor.getByRole("status")).toContainText(
		"The operation could not be completed",
	);
	await expect(editor.getByLabel("Name", { exact: true })).toHaveValue(
		"Previous query project",
	);
	await expect(editor.getByLabel("Description", { exact: true })).toHaveValue(
		"Keep this draft when the response is lost.",
	);
	await editor
		.getByRole("button", { name: "Create project", exact: true })
		.click();
	await expect(
		page.getByRole("heading", { name: "Previous query project", exact: true }),
	).toBeVisible();
	expect(submissions).toHaveLength(2);
	expect(submissions[1]).toEqual(submissions[0]);
	const pageResult = await page.request.get(endpoint);
	expect((await pageResult.json()).items).toHaveLength(1);

	const create = await page.request.post(endpoint, {
		headers,
		data: {
			name: "Current query project",
			slug: `current-${suffix}`,
			operationKey: randomUUID(),
		},
	});
	expect(create.status()).toBe(200);
	let releaseOld = () => {};
	const oldResponse = new Promise<void>((resolve) => {
		releaseOld = resolve;
	});
	let delivered = () => {};
	const oldDelivered = new Promise<void>((resolve) => {
		delivered = resolve;
	});
	let queries = 0;
	await page.route("**/api/rpc/projects/list**", async (route) => {
		queries++;
		const index = queries;
		const response = await route.fetch();
		if (index === 1) await oldResponse;
		await route.fulfill({ response });
		if (index === 1) delivered();
	});
	await page.getByLabel("Search projects", { exact: true }).fill("Previous");
	await page.getByRole("button", { name: "Search", exact: true }).click();
	await expect.poll(() => queries).toBe(1);
	await page.getByLabel("Search projects", { exact: true }).fill("Current");
	await page.getByRole("button", { name: "Search", exact: true }).click();
	await expect(
		page.getByRole("heading", { name: "Current query project", exact: true }),
	).toBeVisible();
	releaseOld();
	await oldDelivered;
	await page.waitForLoadState("networkidle");
	await expect(
		page.getByRole("heading", { name: "Previous query project", exact: true }),
	).toHaveCount(0);
	await expect(
		page.getByRole("heading", { name: "Current query project", exact: true }),
	).toBeVisible();
});

test("project actions honor a different organization's denial and keep the rejected draft", async ({
	page,
	browser,
	baseURL,
}) => {
	test.setTimeout(120_000);
	const suffix = randomUUID().slice(0, 8);
	await dashboardSignUp(page, `project-owner-${suffix}@example.test`);
	const headers = { origin: baseURL ?? "" };
	const organization = await page.request.post("/api/v1/organizations", {
		headers,
		data: {
			name: "Private studio",
			slug: `private-${suffix}`,
			operationKey: randomUUID(),
		},
	});
	expect(organization.status()).toBe(200);
	const { id: organizationId } = await organization.json();
	const endpoint = `/api/v1/organizations/${organizationId}/projects`;
	const project = await page.request.post(endpoint, {
		headers,
		data: {
			name: "Private project",
			slug: `private-project-${suffix}`,
			operationKey: randomUUID(),
		},
	});
	expect(project.status()).toBe(200);
	const otherContext = await browser.newContext();
	try {
		const other = await otherContext.newPage();
		await dashboardSignUp(other, `project-outsider-${suffix}@example.test`);
		await other.goto(`/en/organizations/${organizationId}/projects`);
		await expect(
			other.getByText("You do not have permission for this operation.").first(),
		).toBeVisible();
		await expect(
			other.getByRole("heading", { name: "Private project", exact: true }),
		).toHaveCount(0);
		await other
			.getByRole("button", { name: "New project", exact: true })
			.click();
		const editor = other.getByRole("region", {
			name: "New project",
			exact: true,
		});
		await editor.getByLabel("Name", { exact: true }).fill("Rejected project");
		await editor.getByLabel("Slug", { exact: true }).fill(`rejected-${suffix}`);
		await editor
			.getByRole("button", { name: "Create project", exact: true })
			.click();
		await expect(editor.getByRole("status")).toContainText(
			"You do not have permission",
		);
		await expect(editor.getByLabel("Name", { exact: true })).toHaveValue(
			"Rejected project",
		);
		await expect(
			editor.getByRole("button", { name: "Create project", exact: true }),
		).toBeEnabled();
		const rows = await page.request.get(endpoint);
		expect(
			(await rows.json()).items.map((item: { name: string }) => item.name),
		).toEqual(["Private project"]);
	} finally {
		await otherContext.close();
	}
});

test("archiving a selected workspace preserves a project draft and requires an explicit new destination", async ({
	page,
	baseURL,
}) => {
	test.setTimeout(120_000);
	const suffix = randomUUID().slice(0, 8);
	await dashboardSignUp(page, `workspace-draft-${suffix}@example.test`);
	const headers = { origin: baseURL ?? "" };
	const organization = await page.request.post("/api/v1/organizations", {
		headers,
		data: {
			name: "Draft studio",
			slug: `draft-${suffix}`,
			operationKey: randomUUID(),
		},
	});
	expect(organization.status()).toBe(200);
	const { id: organizationId } = await organization.json();
	const endpoint = `/api/v1/organizations/${organizationId}`;
	const createdWorkspace = await page.request.post(`${endpoint}/workspaces`, {
		headers,
		data: {
			name: "Design studio",
			slug: `design-${suffix}`,
			operationKey: randomUUID(),
		},
	});
	expect(createdWorkspace.status()).toBe(200);
	const workspace = await createdWorkspace.json();
	await page.goto(`/en/organizations/${organizationId}/projects`);
	const workspaces = page.getByRole("region", {
		name: "Workspaces",
		exact: true,
	});
	await expect(
		workspaces.getByRole("heading", { name: "Design studio", exact: true }),
	).toBeVisible();
	await page.getByRole("button", { name: "New project", exact: true }).click();
	const editor = page.getByRole("region", { name: "New project", exact: true });
	await editor
		.getByLabel("Name", { exact: true })
		.fill("Preserved project draft");
	await editor.getByLabel("Slug", { exact: true }).fill(`preserved-${suffix}`);
	await editor
		.getByLabel("Description", { exact: true })
		.fill("Keep these details while changing the destination.");
	await editor
		.getByLabel("Workspace", { exact: true })
		.selectOption(workspace.id);
	await workspaces
		.getByRole("button", { name: "Archive", exact: true })
		.click();
	await page
		.getByRole("dialog")
		.getByRole("button", { name: "Archive workspace", exact: true })
		.click();
	await expect(
		workspaces.getByRole("button", { name: "Unarchive", exact: true }),
	).toBeVisible();
	await expect(editor.getByLabel("Workspace", { exact: true })).toHaveValue(
		workspace.id,
	);
	await expect(editor.locator("select option:checked")).toHaveText(
		"Selected workspace is unavailable",
	);
	await editor
		.getByRole("button", { name: "Create project", exact: true })
		.click();
	await expect(editor.getByRole("alert")).toHaveText(
		"Choose an available workspace, or select No workspace.",
	);
	await expect(editor.getByLabel("Workspace", { exact: true })).toBeFocused();
	await expect(editor.getByLabel("Name", { exact: true })).toHaveValue(
		"Preserved project draft",
	);
	await expect(editor.getByLabel("Description", { exact: true })).toHaveValue(
		"Keep these details while changing the destination.",
	);
	const beforeCreate = await page.request.get(`${endpoint}/projects`);
	expect((await beforeCreate.json()).items).toHaveLength(0);
	await editor.getByLabel("Workspace", { exact: true }).selectOption("");
	await editor
		.getByRole("button", { name: "Create project", exact: true })
		.click();
	await expect(
		page.getByRole("heading", { name: "Preserved project draft", exact: true }),
	).toBeVisible();
	const afterCreate = await page.request.get(`${endpoint}/projects`);
	const created = (await afterCreate.json()).items;
	expect(created).toHaveLength(1);
	expect(created[0].workspaceId).toBeNull();
});

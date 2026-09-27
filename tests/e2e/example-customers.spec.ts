import { randomUUID } from "node:crypto";
import { expect, type Page, test } from "@playwright/test";
import { exampleCustomerInputs } from "../../packages/testing/src/example-customers/data";
import {
	type CustomerFixtureEnv,
	customerFixtureRuntime,
} from "../../packages/testing/src/example-customers/fixture";

test.describe.configure({ mode: "serial" });
let runtime: ReturnType<typeof customerFixtureRuntime>;
test.beforeAll(async ({ baseURL }) => {
	runtime = customerFixtureRuntime(
		process.env as CustomerFixtureEnv,
		baseURL ?? "http://localhost:3102",
	);
});
test.afterAll(async () => {
	await runtime?.close();
});
async function fixture(page: Page, count = 90) {
	const email = `customers-${randomUUID()}@example.test`;
	const owner = await runtime.human(email);
	const org = (
		await runtime.tenancy.createOrganization(owner.actor, {
			name: "Customers reference studio",
			slug: `customers-${randomUUID()}`,
			operationKey: randomUUID(),
		})
	).id;
	for (const value of exampleCustomerInputs(count))
		await runtime.exampleCustomers.create(owner.actor, org, value);
	await page.context().addCookies(
		owner.cookie.split("; ").map((item) => {
			const split = item.indexOf("=");
			return {
				name: item.slice(0, split),
				value: item.slice(split + 1),
				url: runtime.origin,
			};
		}),
	);
	return { owner, org, path: `/en/organizations/${org}/customers` };
}
test("real CRUD, URL queries, cursor navigation, keyboard dialogs and both locale layouts", async ({
	page,
}, info) => {
	const f = await fixture(page);
	await page.goto(f.path);
	await expect(
		page.getByRole("heading", { name: "Customers", exact: true }),
	).toBeVisible();
	await expect(page.locator("tbody tr")).toHaveCount(25);
	await page.screenshot({
		path: info.outputPath("customers-desktop.png"),
		fullPage: true,
	});
	await page.getByRole("button", { name: "Add customer", exact: true }).click();
	await expect(page.getByRole("dialog")).toBeVisible();
	await page
		.getByRole("button", { name: "Save customer", exact: true })
		.click();
	await expect(page.getByLabel("Name", { exact: true })).toBeFocused();
	await expect(
		page.getByRole("dialog").getByRole("alert").first(),
	).toContainText("1–120");
	await page.getByLabel("Name", { exact: true }).fill("Zoe Synthetic");
	await page.keyboard.press("Tab");
	await expect(page.getByLabel("Email", { exact: true })).toBeFocused();
	await page.keyboard.type("zoe@example.test");
	await page
		.getByLabel("Company (Optional)", { exact: true })
		.fill("Zebra Studio");
	await page
		.getByRole("dialog")
		.getByLabel("Status", { exact: true })
		.selectOption("active");
	await page
		.getByRole("button", { name: "Save customer", exact: true })
		.click();
	await expect(page.getByRole("dialog")).not.toBeVisible();
	await expect(
		page.getByRole("button", { name: "Add customer", exact: true }),
	).toBeFocused();
	await expect(
		page.getByRole("button", {
			name: "View customer: Zoe Synthetic",
			exact: true,
		}),
	).toBeVisible();
	await page.getByLabel("Search customers", { exact: true }).fill("Zoe");
	await page.getByRole("button", { name: "Search", exact: true }).click();
	await expect(page).toHaveURL(/search=Zoe/);
	await expect(page.locator("tbody tr")).toHaveCount(1);
	await page.reload();
	await expect(
		page.getByLabel("Search customers", { exact: true }),
	).toHaveValue("Zoe");
	await page
		.getByRole("button", { name: "Edit customer: Zoe Synthetic", exact: true })
		.click();
	await expect(page.getByLabel("Name", { exact: true })).toBeEnabled();
	await page.getByLabel("Name", { exact: true }).fill("Zoe Revised");
	await page
		.getByRole("button", { name: "Save customer", exact: true })
		.click();
	await expect(
		page.getByRole("button", {
			name: "View customer: Zoe Revised",
			exact: true,
		}),
	).toBeVisible();
	await page
		.getByRole("button", { name: "Clear filters", exact: true })
		.click();
	await page.getByLabel("Rows per page").selectOption("10");
	await expect(page.locator("tbody tr")).toHaveCount(10);
	await page.getByRole("button", { name: "Next", exact: true }).focus();
	await page.keyboard.press("Enter");
	await expect(
		page.getByRole("button", { name: "Previous", exact: true }),
	).toBeEnabled();
	await page.getByLabel("Sort by", { exact: true }).selectOption("company");
	await expect(
		page.getByRole("button", { name: "Previous", exact: true }),
	).toBeDisabled();
	await page.getByLabel("Sort direction").selectOption("asc");
	await expect(
		page.getByRole("columnheader", { name: /Company/ }),
	).toHaveAttribute("aria-sort", "ascending");
	await page.getByLabel("Status", { exact: true }).selectOption("active");
	await expect(page).toHaveURL(/status=active/);
	await page.goBack();
	await expect(page.getByLabel("Status", { exact: true })).toHaveValue("");
	await page.getByLabel("Language", { exact: true }).selectOption("es");
	await expect(
		page.getByRole("heading", { name: "Clientes", exact: true }),
	).toBeVisible();
	await page
		.getByRole("button", { name: "Añadir cliente", exact: true })
		.click();
	await page.keyboard.press("Escape");
	await expect(
		page.getByRole("button", { name: "Añadir cliente", exact: true }),
	).toBeFocused();
	await page.getByRole("button", { name: "Cambiar tema de color" }).click();
	await page.screenshot({
		path: info.outputPath("customers-spanish-dark.png"),
		fullPage: true,
	});
	await page.setViewportSize({ width: 390, height: 844 });
	await expect(page.locator("tbody tr")).toHaveCount(10);
	await page.screenshot({
		path: info.outputPath("customers-mobile.png"),
		fullPage: true,
	});
	expect(
		await page.evaluate(
			() => document.documentElement.scrollWidth <= innerWidth,
		),
	).toBe(true);
	await expect(
		page.getByRole("button", { name: /Editar cliente:/ }).first(),
	).toBeVisible();
});

test("last-row deletion returns to previous page and conflict/failure preserves drafts", async ({
	page,
}, info) => {
	const f = await fixture(page, 11);
	await page.goto(`${f.path}?limit=10`);
	await expect(page.locator("tbody tr")).toHaveCount(10);
	await page.getByRole("button", { name: "Next", exact: true }).click();
	await expect(page.locator("tbody tr")).toHaveCount(1);
	const name = await page.locator(".customers-name").innerText();
	await page
		.getByRole("button", { name: `Delete customer: ${name}`, exact: true })
		.click();
	await expect(page.getByRole("dialog")).toContainText(name);
	await expect(page.getByRole("dialog")).toContainText(
		"not permanently erased",
	);
	await expect(
		page.getByRole("button", { name: "Confirm deletion", exact: true }),
	).toBeEnabled();
	await page
		.getByRole("button", { name: "Confirm deletion", exact: true })
		.click();
	await expect(page.locator("tbody tr")).toHaveCount(10);
	await expect(
		page.getByRole("button", { name: "Previous", exact: true }),
	).toBeDisabled();
	const row = (
		await runtime.exampleCustomers.list(f.owner.actor, f.org, { limit: 10 })
	).items[0];
	await page
		.getByRole("button", { name: `Edit customer: ${row.name}`, exact: true })
		.click();
	await expect(page.getByLabel("Name", { exact: true })).toBeEnabled();
	await runtime.exampleCustomers.update(f.owner.actor, f.org, {
		id: row.id,
		version: row.version,
		name: "Concurrent edit",
		email: row.email,
		company: row.company ?? "",
		status: row.status,
		operationKey: randomUUID(),
	});
	await page.getByLabel("Name", { exact: true }).fill("My preserved draft");
	await page
		.getByRole("button", { name: "Save customer", exact: true })
		.click();
	await expect(page.getByRole("dialog").getByRole("alert")).toContainText(
		"draft is preserved",
	);
	await expect(page.getByLabel("Name", { exact: true })).toHaveValue(
		"My preserved draft",
	);
	await page.screenshot({
		path: info.outputPath("customers-stale-edit.png"),
		fullPage: true,
	});
	await page
		.getByRole("button", { name: "Reload latest (discard draft)", exact: true })
		.click();
	await expect(page.getByLabel("Name", { exact: true })).toHaveValue(
		"Concurrent edit",
	);
	await page.keyboard.press("Escape");
	// Simulate a lost response after the server commits. The same submission key must replay.
	let first = true;
	const keys: string[] = [];
	await page.route("**/api/rpc/exampleCustomers/create", async (route) => {
		keys.push(route.request().postDataJSON().json.operationKey);
		if (first) {
			first = false;
			await route.fetch();
			await route.abort();
		} else await route.continue();
	});
	await page.getByRole("button", { name: "Add customer", exact: true }).click();
	await page.getByLabel("Name", { exact: true }).fill("Retry contact");
	await page.getByLabel("Email", { exact: true }).fill("retry@example.test");
	await page
		.getByRole("button", { name: "Save customer", exact: true })
		.click();
	await expect(page.getByRole("dialog").getByRole("alert")).toContainText(
		"changes are still here",
	);
	await expect(page.getByLabel("Name", { exact: true })).toHaveValue(
		"Retry contact",
	);
	await page
		.getByRole("button", { name: "Save customer", exact: true })
		.click();
	await expect(page.getByRole("dialog")).not.toBeVisible();
	expect(keys).toHaveLength(2);
	expect(keys[0]).toBe(keys[1]);
	expect(
		(
			await runtime.exampleCustomers.list(f.owner.actor, f.org, {
				search: "Retry contact",
			})
		).items,
	).toHaveLength(1);
});

test("member can read, denied mutations keep values, and obsolete query responses are ignored", async ({
	page,
}) => {
	const f = await fixture(page, 30);
	let release: () => void = () => {};
	const delayed = new Promise<void>((resolve) => {
		release = resolve;
	});
	let intercept = true;
	await page.route("**/api/rpc/exampleCustomers/list", async (route) => {
		if (intercept) {
			intercept = false;
			await delayed;
		}
		await route.continue();
	});
	await page.goto(f.path);
	await expect(
		page.getByText("Loading customers…", { exact: true }),
	).toBeVisible();
	await page
		.getByLabel("Search customers", { exact: true })
		.fill("no-matching-customer");
	await page.getByRole("button", { name: "Search", exact: true }).click();
	await expect(
		page.getByRole("heading", { name: "No matching customers", exact: true }),
	).toBeVisible();
	release();
	await expect(page.locator("tbody tr")).toHaveCount(0);
	// A rejected/expired cursor must reset even when the URL already contains defaults.
	await page.unrouteAll({ behavior: "wait" });
	let rejectCursor = true;
	await page.route("**/api/rpc/exampleCustomers/list", async (route) => {
		const payload = route.request().postDataJSON();
		if (payload.json.cursor && rejectCursor) {
			rejectCursor = false;
			payload.json.cursor = "invalid-cursor";
			await route.fulfill({
				response: await route.fetch({ postData: JSON.stringify(payload) }),
			});
		} else await route.continue();
	});
	await page.goto(`${f.path}?sort=createdAt&direction=desc&limit=25`);
	await expect(page.locator("tbody tr")).toHaveCount(25);
	await page.getByRole("button", { name: "Next", exact: true }).click();
	await expect(page.getByRole("main").getByRole("alert")).toContainText(
		"cursor expired",
	);
	await page
		.getByRole("button", { name: "Clear filters", exact: true })
		.last()
		.click();
	await expect(page.locator("tbody tr")).toHaveCount(25);
	await expect(
		page.getByRole("button", { name: "Previous", exact: true }),
	).toBeDisabled();
	const member = await runtime.human(`reader-${randomUUID()}@example.test`);
	const email = (
		await runtime.identityPool.query(
			'SELECT email FROM identity."user" WHERE id=$1',
			[member.actor.userId],
		)
	).rows[0].email;
	const invite = await runtime.tenancy.invite(f.owner.actor, f.org, {
		email,
		role: "member",
		operationKey: randomUUID(),
	});
	await runtime.tenancy.acceptInvitation(member.actor, f.org, {
		token: runtime.invitations.get(invite.id) ?? "",
		operationKey: randomUUID(),
	});
	await page.context().clearCookies();
	await page.context().addCookies(
		member.cookie.split("; ").map((item) => {
			const i = item.indexOf("=");
			return {
				name: item.slice(0, i),
				value: item.slice(i + 1),
				url: runtime.origin,
			};
		}),
	);
	await page.goto(f.path);
	await expect(page.locator("tbody tr")).toHaveCount(25);
	await page.getByRole("button", { name: "Add customer", exact: true }).click();
	await page.getByLabel("Name", { exact: true }).fill("Denied draft");
	await page.getByLabel("Email", { exact: true }).fill("denied@example.test");
	await page
		.getByRole("button", { name: "Save customer", exact: true })
		.click();
	await expect(page.getByRole("dialog").getByRole("alert")).toContainText(
		"don’t have access",
	);
	await expect(page.getByLabel("Name", { exact: true })).toHaveValue(
		"Denied draft",
	);
});

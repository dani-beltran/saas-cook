import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { dashboardSignUp } from "./dashboard-helpers";

const png = Buffer.from(
	"iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAIAAAAlC+aJAAAAeklEQVR4nO3PUQkAIBTAwBfCwAYwtCH8OITBAtxmnf11wwUNaEEDWtCAFjSgBQ1oQQNa0IAWNKAFDWhBA1rQgBY0oAUNaEEDWtCAFjSgBQ1oQQNa0IAWNKAFDWhBA1rQgBY0oAUNaEEDWtCAFjSgBQ1oQQNa0IAWPHYB4w4BDwwW5x4AAAAASUVORK5CYII=",
	"base64",
);
const upload = { name: "portrait.png", mimeType: "image/png", buffer: png };

test("personal appearance persists across devices, SSR, tabs and account switches; System follows the OS", async ({
	page,
	browser,
	baseURL,
}, testInfo) => {
	const email = `appearance-${randomUUID()}@example.test`;
	await dashboardSignUp(page, email);
	const errors: string[] = [];
	page.on("pageerror", (error) => errors.push(error.message));
	await page.getByRole("radio", { name: "Dark", exact: true }).check();
	await expect(page.locator("html")).toHaveAttribute("data-mode", "dark");
	await expect(page.getByText("Saved", { exact: true })).toBeVisible();
	await expect(page.locator('meta[name="color-scheme"]')).toHaveAttribute(
		"content",
		"dark",
	);
	const noJs = await browser.newContext({
		baseURL,
		javaScriptEnabled: false,
		colorScheme: "light",
		storageState: await page.context().storageState(),
	});
	try {
		const initial = await noJs.newPage();
		for (const path of ["/en/account", "/es/account", "/auth/confirm"]) {
			await initial.goto(path);
			await expect(initial.locator("html")).toHaveAttribute(
				"data-mode",
				"dark",
			);
			await expect(
				initial.locator('meta[name="color-scheme"]'),
			).toHaveAttribute("content", "dark");
			await expect(initial.locator("body")).toHaveCSS(
				"background-color",
				"rgb(17, 33, 42)",
			);
		}
	} finally {
		await noJs.close();
	}
	const device = await browser.newContext({ baseURL });
	try {
		const other = await device.newPage();
		await other.goto("/en/account");
		await other.getByLabel("Email", { exact: true }).fill(email);
		await other
			.getByLabel("Password", { exact: true })
			.fill("Browser test password 2026!");
		await other.getByRole("button", { name: "Sign in", exact: true }).click();
		await expect(
			other.getByRole("radio", { name: "Dark", exact: true }),
		).toBeChecked();
		await expect(other.locator("html")).toHaveAttribute("data-mode", "dark");
	} finally {
		await device.close();
	}
	const tab = await page.context().newPage();
	await tab.goto("/en/account");
	await page.getByRole("radio", { name: "System", exact: true }).check();
	await expect(page.getByText("Saved", { exact: true })).toBeVisible();
	await expect(tab.locator("html")).toHaveAttribute("data-mode", "system");
	await tab.close();
	for (const locale of ["en", "es"] as const) {
		await page.goto(`/${locale}/account`);
		for (const scheme of ["light", "dark"] as const) {
			await page.emulateMedia({ colorScheme: scheme });
			await expect(page.locator("body")).toHaveCSS(
				"background-color",
				scheme === "light" ? "rgb(248, 250, 252)" : "rgb(17, 33, 42)",
			);
			for (const width of [1440, 390]) {
				await page.setViewportSize({ width, height: 960 });
				expect(
					await page.evaluate(
						() => document.documentElement.scrollWidth <= innerWidth,
					),
				).toBe(true);
				await page.screenshot({
					path: testInfo.outputPath(
						`appearance-${locale}-${scheme}-${width}.png`,
					),
					fullPage: true,
				});
			}
		}
	}
	await page.goto("/en/account");
	await page.getByRole("radio", { name: "Dark", exact: true }).check();
	await expect(page.getByText("Saved", { exact: true })).toBeVisible();
	let releaseOld = () => {};
	const oldResponse = new Promise<void>((resolve) => {
		releaseOld = resolve;
	});
	let committed = false;
	await page.route("**/api/auth/personal-settings", async (route) => {
		if (route.request().method() !== "POST") return route.continue();
		const response = await route.fetch();
		committed = true;
		await oldResponse;
		await route.fulfill({ response });
	});
	await page.getByRole("radio", { name: "Light", exact: true }).check();
	await expect.poll(() => committed).toBe(true);
	await page.getByRole("button", { name: "Sign out", exact: true }).click();
	await expect(page.locator("html")).toHaveAttribute("data-mode", "system");
	await dashboardSignUp(page, `second-${randomUUID()}@example.test`);
	await expect(
		page.getByRole("radio", { name: "System", exact: true }),
	).toBeChecked();
	await expect(page.locator("html")).toHaveAttribute("data-mode", "system");
	releaseOld();
	await page.unrouteAll({ behavior: "wait" });
	await expect(page.locator("html")).toHaveAttribute("data-mode", "system");
	expect(errors).toEqual([]);
});

test("theme saves recover from failure and superseded choices, with keyboard selection", async ({
	page,
}) => {
	await dashboardSignUp(page, `theme-race-${randomUUID()}@example.test`);
	await page.getByRole("radio", { name: "Dark", exact: true }).check();
	await expect(page.getByText("Saved", { exact: true })).toBeVisible();
	await page.route("**/api/auth/personal-settings", async (route) => {
		if (route.request().method() === "POST") await route.abort("failed");
		else await route.continue();
	});
	await page.getByRole("radio", { name: "Light", exact: true }).check();
	await expect(page.getByRole("main").getByRole("alert")).toContainText(
		"couldn’t save",
	);
	await expect(page.locator("html")).toHaveAttribute("data-mode", "dark");
	await page.unroute("**/api/auth/personal-settings");
	let release = () => {};
	const hold = new Promise<void>((resolve) => {
		release = resolve;
	});
	let count = 0;
	await page.route("**/api/auth/personal-settings", async (route) => {
		if (route.request().method() !== "POST") return route.continue();
		const response = await route.fetch();
		count++;
		if (count === 1) await hold;
		await route.fulfill({ response });
	});
	try {
		await page.getByRole("radio", { name: "Light", exact: true }).check();
		await expect.poll(() => count).toBe(1);
		await page.getByRole("radio", { name: "System", exact: true }).check();
		await expect(page.locator("html")).toHaveAttribute("data-mode", "system");
	} finally {
		release();
	}
	await expect(page.getByText("Saved", { exact: true })).toBeVisible();
	await page.reload();
	await expect(
		page.getByRole("radio", { name: "System", exact: true }),
	).toBeChecked();
	await page.getByRole("radio", { name: "System", exact: true }).focus();
	await page.keyboard.press("ArrowLeft");
	await expect(
		page.getByRole("radio", { name: "Dark", exact: true }),
	).toBeChecked();
	await expect(
		page.getByRole("radio", { name: "Dark", exact: true }),
	).toBeFocused();
	await expect(page.getByText("Saved", { exact: true })).toBeVisible();
});

test("upload, replacement, validation, lost responses, fallback and removal update Account and sidebar", async ({
	page,
}, testInfo) => {
	await dashboardSignUp(page, `avatar-${randomUUID()}@example.test`);
	const input = page.getByLabel("Profile picture", { exact: true });
	await expect(
		page.getByRole("button", { name: "Upload picture", exact: true }),
	).toBeEnabled();
	await input.setInputFiles(upload);
	await expect(
		page.getByText("Profile picture updated.", { exact: true }),
	).toBeVisible();
	await expect(page.locator(".user-avatar img")).toHaveCount(2);
	const original = await page
		.locator(".account-avatar img")
		.getAttribute("src");
	await input.setInputFiles({
		name: "fake.png",
		mimeType: "image/png",
		buffer: Buffer.from("not an image"),
	});
	await expect(page.getByRole("main").getByRole("alert")).toContainText(
		"Choose a valid",
	);
	await expect(page.locator(".account-avatar img")).toHaveAttribute(
		"src",
		original ?? "",
	);
	await input.setInputFiles({
		name: "large.png",
		mimeType: "image/png",
		buffer: Buffer.alloc(5 * 1024 * 1024 + 1),
	});
	await expect(page.getByRole("main").getByRole("alert")).toContainText(
		"Choose a valid",
	);
	await page.route(
		"**/api/auth/avatar",
		async (route) => {
			const response = await route.fetch();
			expect(response.status()).toBe(200);
			await route.abort("failed"); // Service committed but response delivery was lost.
		},
		{ times: 1 },
	);
	await input.setInputFiles(upload);
	await expect(
		page.getByText("Profile picture updated.", { exact: true }),
	).toBeVisible();
	await expect(page.locator(".account-avatar img")).not.toHaveAttribute(
		"src",
		original ?? "",
	);
	await page.reload();
	await expect(page.locator(".user-avatar img")).toHaveCount(2);
	await expect(page.locator(".account-avatar")).toHaveCSS(
		"border-radius",
		"50%",
	);
	for (const locale of ["en", "es"]) {
		await page.goto(`/${locale}/account`);
		await expect(page.locator(".account-avatar img")).toBeVisible();
		for (const colorScheme of ["light", "dark"] as const) {
			await page.emulateMedia({ colorScheme });
			for (const width of [1440, 390]) {
				await page.setViewportSize({ width, height: 960 });
				expect(
					await page.evaluate(
						() => document.documentElement.scrollWidth <= innerWidth,
					),
				).toBe(true);
				await page.screenshot({
					path: testInfo.outputPath(
						`avatar-${locale}-${colorScheme}-${width}.png`,
					),
					fullPage: true,
				});
			}
		}
	}
	await page.goto("/en/account");
	await page.route("**/api/auth/avatar?version=*", (route) =>
		route.fulfill({ status: 404 }),
	);
	await page.reload();
	await expect(page.locator(".user-avatar img")).toHaveCount(0);
	await expect(page.locator(".account-avatar")).toHaveText("BT");
	await expect(page.locator(".dashboard-avatar")).toHaveText("BT");
	await page.unroute("**/api/auth/avatar?version=*");
	await page
		.getByRole("button", { name: "Remove picture", exact: true })
		.click();
	await expect(
		page.getByText("Profile picture updated.", { exact: true }),
	).toBeVisible();
	await expect(
		page.getByRole("button", { name: "Upload picture", exact: true }),
	).toBeVisible();
	await expect(page.locator(".user-avatar img")).toHaveCount(0);
});

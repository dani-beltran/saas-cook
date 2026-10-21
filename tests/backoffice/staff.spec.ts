import { createHmac } from "node:crypto";
import { expect, test } from "@playwright/test";

const required = (key: string) => {
	const value = process.env[key];
	if (!value) throw new Error(`Missing fixture ${key}`);
	return value;
};

test("invited staff passkey, audited scoped lookup, separate cookie and Spanish states", async ({
	page,
	context,
}) => {
	const origin = "https://localhost:3104";
	await page.route("**/*", async (route) => {
		const r = route.request(),
			url = new URL(r.url());
		if (url.origin !== origin) return route.continue();
		const time = String(Math.floor(Date.now() / 1000)),
			source = "127.0.0.1";
		await route.continue({
			headers: {
				...r.headers(),
				"x-backoffice-source": source,
				"x-backoffice-time": time,
				"x-backoffice-signature": createHmac(
					"sha256",
					required("BACKOFFICE_INGRESS_SECRET"),
				)
					.update(
						`backoffice-ingress:v1\n${origin}\n${r.method()}\n${url.pathname}${url.search}\n${time}\n${source}`,
					)
					.digest("hex"),
			},
		});
	});
	const cdp = await context.newCDPSession(page);
	await cdp.send("WebAuthn.enable");
	await cdp.send("WebAuthn.addVirtualAuthenticator", {
		options: {
			protocol: "ctap2",
			transport: "internal",
			hasResidentKey: true,
			hasUserVerification: true,
			isUserVerified: true,
			automaticPresenceSimulation: true,
		},
	});
	await page.goto("/en");
	await expect(
		page.getByRole("heading", { name: "Staff backoffice" }),
	).toBeVisible();
	await page.getByLabel("Invitation code").fill(required("BO_TEST_INVITATION"));
	await page.getByRole("button", { name: "Enroll invited passkey" }).click();
	await expect(page.getByRole("status")).toContainText("Passkey enrolled");
	await page.getByRole("button", { name: "Sign in with a passkey" }).click();
	await expect(page.getByRole("status")).toContainText("Signed in");
	const cookie = (await context.cookies()).find(
		(c) => c.name === "__Host-backoffice-session",
	);
	expect(cookie?.secure).toBe(true);
	expect(cookie?.httpOnly).toBe(true);
	expect(cookie?.sameSite).toBe("Strict");
	expect(cookie?.path).toBe("/");
	await page
		.getByLabel("Organization ID")
		.fill(required("BO_TEST_ORGANIZATION"));
	await page.getByLabel("Case reference").fill("BO-BROWSER-1");
	await page.getByRole("button", { name: "Look up organization" }).click();
	await expect(
		page.getByRole("heading", { name: "Synthetic authorized organization" }),
	).toBeVisible();
	await expect(
		page.getByText("Audit reference", { exact: true }),
	).toBeVisible();
	await page.screenshot({
		path: "artifacts/backoffice/lookup.png",
		fullPage: true,
	});
	await page
		.getByLabel("Organization ID")
		.fill(required("BO_TEST_OTHER_ORGANIZATION"));
	await page.getByRole("button", { name: "Look up organization" }).click();
	await expect(page.getByRole("status")).toContainText("Access unavailable");
	await expect(
		page.getByText("Other organization", { exact: true }),
	).toHaveCount(0);
	await page.getByRole("button", { name: "Sign out" }).click();
	await page
		.getByLabel("Organization ID")
		.fill(required("BO_TEST_ORGANIZATION"));
	await page.getByRole("button", { name: "Look up organization" }).click();
	await expect(page.getByRole("status")).toContainText("Access unavailable");
	await page.setViewportSize({ width: 390, height: 844 });
	await page.goto("/es");
	await expect(
		page.getByRole("heading", { name: "Administración interna" }),
	).toBeVisible();
	const direct = await context.request.get(`${origin}/en`);
	expect(direct.status()).toBe(503);
});

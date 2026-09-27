import { createHmac, randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { Pool } from "pg";

test("task-09 directory uses current tenant services, navigation, keyboard and both locales", async ({
	page,
	baseURL,
}) => {
	if (!baseURL) throw new Error("Missing isolated browser origin");
	const identity = new Pool({
		connectionString: process.env.IDENTITY_DATABASE_URL,
		max: 1,
	});
	const web = new Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
	const user = randomUUID(),
		token = randomUUID();
	const email = `directory-${user}@example.test`;
	try {
		const epoch = (
			await web.query("SELECT recovery_epoch FROM foundation.installation")
		).rows[0].recovery_epoch;
		await identity.query(
			'INSERT INTO identity."user"(id,name,email,email_verified) VALUES($1,$2,$3,true)',
			[user, "Held-out directory member", email],
		);
		await identity.query(
			"INSERT INTO identity.session(id,user_id,token,expires_at,authentication_method,authenticated_at,user_verified,mfa,recovery_epoch) VALUES($1,$2,$3,clock_timestamp()+interval '1 hour','passkey',clock_timestamp(),true,true,$4)",
			[randomUUID(), user, token, epoch],
		);
		const secret = process.env.AUTH_SECRET;
		if (!secret) throw new Error("Missing synthetic identity configuration");
		const signature = createHmac("sha256", secret)
			.update(token)
			.digest("base64");
		await page.context().addCookies([
			{
				name: "better-auth.session_token",
				value: encodeURIComponent(`${token}.${signature}`),
				url: baseURL,
			},
		]);
		const response = await page.request.post("/api/v1/organizations", {
			headers: { origin: baseURL },
			data: {
				name: "Directory fixture",
				slug: `directory-${randomUUID()}`,
				operationKey: randomUUID(),
			},
		});
		expect(response.ok()).toBe(true);
		const organization = await response.json();
		const id = organization.id;
		expect(id).toEqual(expect.any(String));
		await page.goto(`/en/organizations/${id}`);
		const main = page.getByRole("main");
		const link = page
			.locator(`a[href="/en/organizations/${id}/directory"]`)
			.first();
		await expect(link).toBeVisible();
		await link.focus();
		await expect(link).toBeFocused();
		await page.keyboard.press("Enter");
		await expect(page).toHaveURL(new RegExp(`/organizations/${id}/directory$`));
		await expect(main).toBeVisible();
		// The shared shell also shows the signed-in email. Only directory content
		// proves tenant data was loaded, or that a denied directory disclosed it.
		await expect(main.getByText(email, { exact: true })).toBeVisible();
		const english = await main.getByRole("heading", { level: 1 }).textContent();
		await page.goto(`/es/organizations/${id}/directory`);
		await expect(page.locator("html")).toHaveAttribute("lang", "es");
		await expect(main.getByText(email, { exact: true })).toBeVisible();
		const spanish = await main.getByRole("heading", { level: 1 }).textContent();
		expect(spanish).not.toBe(english);
		await page.goto(`/en/organizations/${randomUUID()}/directory`);
		await expect(main.getByRole("alert")).toBeVisible();
		await expect(main.getByText(email, { exact: true })).toHaveCount(0);
	} finally {
		await Promise.all([identity.end(), web.end()]);
	}
});

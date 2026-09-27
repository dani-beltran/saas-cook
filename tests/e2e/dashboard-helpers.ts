import { createSmtpTransport, deliverIdentityEmails } from "@common-saas/email";
import { expect, type Page } from "@playwright/test";
import { Pool } from "pg";

const password = "Browser test password 2026!";
const mailpit = process.env.MAILPIT_HTTP_URL ?? "http://127.0.0.1:8026";
export async function emailLink(
	email: string,
	pattern = /https?:\/\/[^\s<]+\/auth\/confirm\?token=[A-Za-z0-9_-]+/,
) {
	const worker = new Pool({
		connectionString:
			process.env.WORKER_DATABASE_URL ??
			"postgres://common_saas_worker:local_phase1@127.0.0.1:55433/common_saas",
		max: 1,
	});
	try {
		const delivery = await deliverIdentityEmails(worker, {
			secret:
				process.env.AUTH_SECRET ??
				"local_phase2_synthetic_secret_not_for_production_0001",
			transport: createSmtpTransport({
				host: "127.0.0.1",
				port: 1026,
				from: "security@example.test",
			}),
		});
		expect(delivery.failures).toEqual({
			decrypt: 0,
			render: 0,
			transport: 0,
			receipt: 0,
			expired: 0,
		});
	} finally {
		await worker.end();
	}
	let result = "";
	await expect
		.poll(async () => {
			const response = await fetch(
				`${mailpit}/api/v1/search?query=${encodeURIComponent(`to:${email}`)}`,
			);
			const data = await response.json();
			for (const message of data.messages ?? []) {
				const content = await (
					await fetch(`${mailpit}/api/v1/message/${message.ID}`)
				).json();
				result = String(content.Text).match(pattern)?.[0] ?? "";
				if (result) return true;
			}
			return false;
		})
		.toBe(true);
	return result;
}
export async function dashboardSignUp(
	page: Page,
	email: string,
	entry = "/en/account",
) {
	await page.goto(entry);
	await page
		.getByRole("link", { name: "Create an account", exact: true })
		.click();
	await page.getByLabel("Email", { exact: true }).fill(email);
	await page.getByLabel("Name", { exact: true }).fill("Browser test member");
	await page.getByLabel("Password", { exact: true }).fill(password);
	await page.getByLabel("Confirm password", { exact: true }).fill(password);
	await page
		.getByRole("button", { name: "Create account", exact: true })
		.click();
	await expect(page.getByRole("status")).toContainText(
		"an email is on its way",
	);
	const link = await emailLink(email);
	// A scanner's GET must leave the challenge available for the human confirmation.
	await page.request.get(link);
	await page.goto(link);
	await page
		.getByRole("button", { name: /^(Confirm|Confirmar)$/, exact: true })
		.click();
	await expect(
		page.getByRole("heading", { name: "Your account", exact: true }),
	).toBeVisible();
	return link;
}

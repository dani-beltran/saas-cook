import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { dashboardSignUp, emailLink } from "./dashboard-helpers";

test("organization tabs, retry keys, sensitive denial, and localized member acceptance use real services", async ({
	page,
	browser,
}, testInfo) => {
	test.setTimeout(120_000);
	const id = randomUUID().slice(0, 8);
	const ownerEmail = `org-dashboard-owner-${id}@example.test`;
	const memberEmail = `org-dashboard-member-${id}@example.test`;
	const canceledEmail = `org-dashboard-canceled-${id}@example.test`;
	await dashboardSignUp(page, ownerEmail);
	await page.getByRole("tab", { name: "Organizations", exact: true }).click();
	await page
		.getByLabel("Organization name", { exact: true })
		.fill(`Studio ${id}`);
	await page.getByLabel("URL name", { exact: true }).fill(`studio-${id}`);
	await page
		.getByRole("button", { name: "Create organization", exact: true })
		.click();
	await expect(
		page.getByRole("heading", { name: `Studio ${id}`, exact: true }),
	).toBeVisible();
	const organizationId = new URL(page.url()).pathname.split("/").at(-1);
	const endpoint = `/api/v1/organizations/${organizationId}`;

	await page
		.getByLabel(`Manage member: ${ownerEmail}`, { exact: true })
		.click();
	await page.getByRole("button", { name: "Deactivate", exact: true }).click();
	const confirmation = page.getByRole("dialog");
	await expect(confirmation).toContainText("lose access to the organization");
	await confirmation
		.getByRole("button", { name: "Confirm change", exact: true })
		.click();
	await expect(confirmation.getByRole("status")).toContainText(
		"final owner cannot be deactivated",
	);
	await page.screenshot({
		path: testInfo.outputPath("organization-last-owner-denied.png"),
		fullPage: true,
	});
	await confirmation
		.getByRole("button", { name: "Cancel", exact: true })
		.click();
	expect(
		(await (await page.request.get(endpoint)).json()).membership.status,
	).toBe("active");

	await page.getByRole("tab", { name: "Members", exact: true }).focus();
	await page.keyboard.press("ArrowRight");
	await expect(
		page.getByRole("tab", { name: "Invitations", exact: true }),
	).toBeFocused();
	await expect(
		page.getByRole("tab", { name: "Invitations", exact: true }),
	).toHaveAttribute("aria-selected", "true");
	await page
		.getByRole("button", { name: "Invite member", exact: true })
		.click();
	await expect(
		page
			.getByRole("tabpanel", { name: "Invitations", exact: true })
			.getByRole("alert"),
	).toContainText("Enter a valid email address");
	await page.getByLabel("Email", { exact: true }).fill(canceledEmail);
	await page
		.getByRole("button", { name: "Invite member", exact: true })
		.click();
	await expect(page.getByRole("status")).toContainText("Saved");
	await page.getByLabel("Email", { exact: true }).fill(memberEmail);
	const keys: string[] = [];
	let cancellationKey = "";
	await page.route("**/api/rpc/organizations/command", async (route) => {
		const body = route.request().postDataJSON();
		const command = (body.json ?? body).command;
		if (command.action !== "invite") {
			if (command.action === "cancelInvitation")
				cancellationKey = command.operationKey;
			await route.continue();
			return;
		}
		keys.push(command.operationKey);
		if (keys.length === 1) {
			// The real server commits; the browser loses only the response.
			const response = await route.fetch();
			expect(response.status()).toBe(200);
			await route.abort("failed");
		} else await route.continue();
	});
	await page
		.getByRole("button", { name: "Invite member", exact: true })
		.click();
	await expect(page.getByRole("status")).toContainText(
		"Your changes have been kept",
	);
	await expect(page.getByLabel("Email", { exact: true })).toHaveValue(
		memberEmail,
	);
	// A separate successful action must leave the original submission retryable.
	await page
		.getByRole("listitem")
		.filter({ hasText: canceledEmail })
		.getByRole("button", { name: "Cancel", exact: true })
		.click();
	await confirmation
		.getByRole("button", { name: "Confirm change", exact: true })
		.click();
	await expect(page.getByRole("status")).toContainText("Saved");
	await expect(
		page.getByRole("listitem").filter({ hasText: canceledEmail }),
	).toContainText("Canceled");
	expect(cancellationKey).not.toBe(keys[0]);
	await expect(page.getByLabel("Email", { exact: true })).toHaveValue(
		memberEmail,
	);
	await page
		.getByRole("button", { name: "Invite member", exact: true })
		.click();
	await expect(page.getByRole("status")).toContainText("Saved");
	expect(keys).toHaveLength(2);
	expect(keys[0]).toBe(keys[1]);
	const snapshot = await (await page.request.get(endpoint)).json();
	expect(
		snapshot.invitations.filter(
			(invite: { email: string }) => invite.email === memberEmail,
		),
	).toHaveLength(1);

	await page.getByRole("tab", { name: "Security", exact: true }).click();
	await page
		.getByLabel("Require MFA for every member", { exact: true })
		.check();
	await page
		.getByRole("button", { name: "Save security policy", exact: true })
		.click();
	await confirmation
		.getByRole("button", { name: "Confirm change", exact: true })
		.click();
	await expect(
		confirmation.getByRole("link", {
			name: "Verify in your account",
			exact: false,
		}),
	).toBeVisible();
	expect(
		(await (await page.request.get(endpoint)).json()).organization
			.securityPolicy.requireMfa,
	).toBe(false);
	await confirmation
		.getByRole("button", { name: "Cancel", exact: true })
		.click();
	await expect(
		page.getByLabel("Require MFA for every member", { exact: true }),
	).toBeChecked();

	const memberContext = await browser.newContext();
	const member = await memberContext.newPage();
	try {
		await dashboardSignUp(member, memberEmail);
		const invite = await emailLink(
			memberEmail,
			/https?:\/\/[^\s<]+\/en\/organizations\/[a-f0-9-]+\?invite=[A-Za-z0-9_-]+/,
		);
		await member.goto(invite);
		await expect(
			member.getByRole("heading", {
				name: "Accept your organization invitation",
				exact: true,
			}),
		).toBeVisible();
		await expect(member).not.toHaveURL(/invite=/);
		await member.getByLabel("Language", { exact: true }).selectOption("es");
		await expect(
			member.getByRole("heading", {
				name: "Aceptar invitación a la organización",
				exact: true,
			}),
		).toBeVisible();
		await expect(member).not.toHaveURL(/invite=/);
		await member.getByRole("button", { name: "Aceptar", exact: true }).click();
		await expect(
			member.getByRole("heading", { name: `Studio ${id}`, exact: true }),
		).toBeVisible();
		await expect(
			member.getByRole("heading", { name: "Tu membresía", exact: true }),
		).toBeVisible();
		await expect(member.getByRole("tab")).toHaveCount(0);
		expect((await member.request.get(`${endpoint}/summary`)).status()).toBe(
			200,
		);
		expect((await member.request.get(endpoint)).status()).toBe(403);
		await member.screenshot({
			path: testInfo.outputPath("organization-spanish-member.png"),
			fullPage: true,
		});
	} finally {
		await memberContext.close();
	}
});

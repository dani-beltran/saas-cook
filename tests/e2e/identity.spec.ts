import { randomUUID } from "node:crypto";
import { createSmtpTransport, deliverIdentityEmails } from "@common-saas/email";
import { expect, type Page, test } from "@playwright/test";
import { Pool } from "pg";

const mailpit = process.env.MAILPIT_HTTP_URL ?? "http://127.0.0.1:8026";
async function emailLink(
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
async function signUp(page: Page, email: string) {
	await page.goto("/en/account");
	await page.getByLabel("Email", { exact: true }).fill(email);
	await page.getByLabel("Name", { exact: true }).fill("Browser test member");
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

test("real registration, scanner confirmation, two memberships, per-tab isolation and last-owner guard", async ({
	page,
	context,
}, testInfo) => {
	const id = randomUUID().slice(0, 8);
	const email = `browser-owner-${id}@example.test`;
	const link = await signUp(page, email);
	await page
		.getByLabel("Organization name", { exact: true })
		.fill(`North ${id}`);
	await page.getByLabel("URL name", { exact: true }).fill(`north-${id}`);
	await page
		.getByRole("button", { name: "Create organization", exact: true })
		.click();
	await expect(
		page.getByRole("heading", { name: `North ${id}`, exact: true }),
	).toBeVisible();
	const north = page.url();
	await page.getByRole("button", { name: "Deactivate", exact: true }).click();
	await expect(page.getByRole("status")).toContainText(
		"final owner cannot be deactivated",
	);
	await page
		.getByRole("link", { name: "Back to account", exact: true })
		.click();
	await page
		.getByLabel("Organization name", { exact: true })
		.fill(`South ${id}`);
	await page.getByLabel("URL name", { exact: true }).fill(`south-${id}`);
	await page
		.getByRole("button", { name: "Create organization", exact: true })
		.click();
	await expect(
		page.getByRole("heading", { name: `South ${id}`, exact: true }),
	).toBeVisible();
	const northTab = await context.newPage();
	await northTab.goto(north);
	await expect(
		northTab.getByRole("heading", { name: `North ${id}`, exact: true }),
	).toBeVisible();
	await expect(
		page.getByRole("heading", { name: `South ${id}`, exact: true }),
	).toBeVisible();
	await northTab
		.getByLabel("Team name", { exact: true })
		.fill(`North team ${id}`);
	await northTab
		.getByRole("button", { name: "Create team", exact: true })
		.click();
	await expect(northTab.getByRole("status")).toContainText("Saved");
	await expect(
		northTab.getByRole("heading", {
			name: `North team ${id}`,
			level: 3,
			exact: true,
		}),
	).toBeVisible();
	await page.reload();
	await expect(
		page.getByRole("heading", {
			name: `North team ${id}`,
			level: 3,
			exact: true,
		}),
	).toHaveCount(0);
	await northTab.screenshot({
		path: testInfo.outputPath("organization-desktop.png"),
		fullPage: true,
	});
	await page.goto(link);
	await page
		.getByRole("button", { name: /^(Confirm|Confirmar)$/, exact: true })
		.click();
	await expect(page.getByRole("main").getByRole("alert")).toContainText(
		"invalid or expired",
	);
});

test("real browser WebAuthn enrollment and passwordless sign-in", async ({
	page,
	context,
}, testInfo) => {
	const id = randomUUID().slice(0, 8);
	const client = await context.newCDPSession(page);
	await client.send("WebAuthn.enable");
	await client.send("WebAuthn.addVirtualAuthenticator", {
		options: {
			protocol: "ctap2",
			transport: "internal",
			hasResidentKey: true,
			hasUserVerification: true,
			isUserVerified: true,
			automaticPresenceSimulation: true,
		},
	});
	await signUp(page, `browser-passkey-${id}@example.test`);
	await page
		.getByLabel("Passkey name", { exact: true })
		.fill("Browser credential");
	await page
		.getByRole("button", { name: "Add a passkey", exact: true })
		.click();
	await expect(
		page.getByText("Browser credential", { exact: true }),
	).toBeVisible();
	await page.getByRole("button", { name: "Sign out", exact: true }).click();
	await expect(
		page.getByRole("heading", {
			name: "Sign in to your workspace",
			exact: true,
		}),
	).toBeVisible();
	await page
		.getByRole("button", { name: "Sign in with a passkey", exact: true })
		.click();
	await expect(
		page.getByRole("heading", { name: "Your account", exact: true }),
	).toBeVisible();
	await page.setViewportSize({ width: 390, height: 844 });
	await page.screenshot({
		path: testInfo.outputPath("account-mobile.png"),
		fullPage: true,
	});
	expect(
		await page.evaluate(
			() => document.documentElement.scrollWidth <= innerWidth,
		),
	).toBe(true);
});

for (const outgoingRole of ["member", "inactive"] as const) {
	test(`invitation, team management and ${outgoingRole} ownership transfer change RPC and REST permissions`, async ({
		page,
		browser,
	}, testInfo) => {
		const id = randomUUID().slice(0, 8);
		const ownerEmail = `browser-transfer-owner-${id}@example.test`;
		const recipientEmail = `browser-transfer-recipient-${id}@example.test`;
		const recipientContext = await browser.newContext();
		const recipient = await recipientContext.newPage();
		try {
			await signUp(page, ownerEmail);
			await signUp(recipient, recipientEmail);
			await page
				.getByLabel("Organization name", { exact: true })
				.fill(`Transfer ${id}`);
			await page.getByLabel("URL name", { exact: true }).fill(`transfer-${id}`);
			await page
				.getByRole("button", { name: "Create organization", exact: true })
				.click();
			await expect(
				page.getByRole("heading", { name: `Transfer ${id}`, exact: true }),
			).toBeVisible();
			const organizationPath = new URL(page.url()).pathname;
			const organizationId = organizationPath.split("/").at(-1);
			const origin = new URL(page.url()).origin;
			const endpoint = `${origin}/api/v1/organizations/${organizationId}`;
			expect((await page.request.get(endpoint)).status()).toBe(200);
			expect(
				(await recipient.request.get(`${endpoint}/summary`)).status(),
			).toBe(403);
			const deniedOrigin = await page.request.post(`${endpoint}/commands`, {
				headers: { Origin: "https://untrusted.example.test" },
				data: {
					command: {
						action: "createTeam",
						name: "Untrusted origin",
						operationKey: randomUUID(),
					},
				},
			});
			expect(deniedOrigin.status()).toBe(403);
			await page.getByLabel("Email", { exact: true }).fill(recipientEmail);
			await page
				.getByRole("button", { name: "Invite member", exact: true })
				.click();
			await expect(page.getByRole("status")).toContainText("Saved");
			const invitation = await emailLink(
				recipientEmail,
				/https?:\/\/[^\s<]+\/en\/organizations\/[a-f0-9-]+\?invite=[A-Za-z0-9_-]+/,
			);
			await recipient.goto(invitation);
			await recipient
				.getByRole("button", { name: "Accept", exact: true })
				.click();
			await expect(
				recipient.getByRole("heading", { name: `Transfer ${id}`, exact: true }),
			).toBeVisible();
			expect(
				(await recipient.request.get(`${endpoint}/summary`)).status(),
			).toBe(200);
			expect((await recipient.request.get(endpoint)).status()).toBe(403);
			await page.reload();
			await page
				.getByLabel("Recipient member", { exact: true })
				.selectOption({ label: recipientEmail });
			if (outgoingRole === "member") {
				// Existing clients may omit outgoingRole and retain the member default.
				const before = await (await page.request.get(endpoint)).json();
				expect(
					(
						await page.request.post(`${endpoint}/commands`, {
							headers: { Origin: origin },
							data: {
								command: {
									action: "startTransfer",
									recipientMembershipId: before.members.find(
										(member: { email: string }) =>
											member.email === recipientEmail,
									).id,
									operationKey: randomUUID(),
								},
							},
						})
					).status(),
				).toBe(200);
				await page.reload();
			} else {
				await page
					.getByLabel("Outgoing owner's access after transfer", { exact: true })
					.selectOption(outgoingRole);
				await page
					.getByRole("button", { name: "Nominate recipient", exact: true })
					.click();
				await expect(page.getByRole("status")).toContainText("Saved");
			}
			const pending = await (await page.request.get(endpoint)).json();
			expect(
				pending.transfers.find(
					(item: { status: string }) => item.status === "pending",
				).outgoingRole,
			).toBe(outgoingRole);
			await expect(
				page
					.getByRole("listitem")
					.filter({ hasText: "Outgoing owner's access after transfer" }),
			).toContainText(
				outgoingRole === "inactive" ? "Leave organization" : "Member",
			);
			const transfer = await emailLink(
				recipientEmail,
				/https?:\/\/[^\s<]+\/en\/organizations\/[a-f0-9-]+\?transfer=[a-f0-9-]+/,
			);
			await recipient.goto(transfer);
			await recipient
				.getByRole("button", { name: "Accept", exact: true })
				.click();
			await expect(
				recipient.getByRole("heading", {
					name: "Transfer ownership",
					exact: true,
				}),
			).toBeVisible();
			// The old owner's existing tab retains stale controls; the RPC command must still recheck authoritative ownership.
			await page
				.getByLabel("Team name", { exact: true })
				.fill("Rejected old-owner team");
			await page
				.getByRole("button", { name: "Create team", exact: true })
				.click();
			await expect(page.getByRole("status")).toContainText(
				"Organization settings require administrator access.",
			);
			expect((await page.request.get(endpoint)).status()).toBe(403);
			expect((await page.request.get(`${endpoint}/summary`)).status()).toBe(
				outgoingRole === "inactive" ? 403 : 200,
			);
			expect(
				(
					await recipient.request.post(`${endpoint}/commands`, {
						headers: { Origin: origin },
						data: {
							command: {
								action: "createTeam",
								name: `New owner team ${id}`,
								operationKey: randomUUID(),
							},
						},
					})
				).status(),
			).toBe(200);
			const current = await recipient.request.get(endpoint);
			expect(current.status()).toBe(200);
			const snapshot = await current.json();
			expect(snapshot.membership.role).toBe("owner");
			expect(snapshot.seats.occupied).toBe(outgoingRole === "inactive" ? 1 : 2);
			expect(
				snapshot.members.find(
					(member: { email: string }) => member.email === ownerEmail,
				),
			).toMatchObject({
				role: "member",
				status: outgoingRole === "inactive" ? "inactive" : "active",
			});
			expect(snapshot.teams.map((team: { name: string }) => team.name)).toEqual(
				[`New owner team ${id}`],
			);
			const teamId = snapshot.teams[0].id;
			const teamName = snapshot.teams[0].name;
			expect(snapshot.teams[0].membershipIds).toEqual([]);
			await recipient.reload();
			const team = recipient.getByRole("article", {
				name: `Team ${teamName}`,
				exact: true,
			});
			await expect(team).toContainText("This team has no members.");
			await team
				.getByLabel("Member", { exact: true })
				.selectOption({ label: recipientEmail });
			await team
				.getByRole("button", { name: "Add member to team", exact: true })
				.click();
			await expect(team.getByRole("listitem")).toContainText(recipientEmail);
			expect(
				(await (await recipient.request.get(endpoint)).json()).teams[0]
					.membershipIds,
			).toEqual([snapshot.membership.id]);
			for (const action of ["removeTeam", "removeTeamMember"]) {
				expect(
					(
						await page.request.post(`${endpoint}/commands`, {
							headers: { Origin: origin },
							data: {
								command: {
									action,
									teamId,
									...(action === "removeTeamMember"
										? { membershipId: snapshot.membership.id }
										: {}),
									operationKey: randomUUID(),
								},
							},
						})
					).status(),
				).toBe(403);
			}
			await team
				.getByRole("button", {
					name: `Remove ${recipientEmail} from ${teamName}`,
					exact: true,
				})
				.click();
			await expect(team).toContainText("This team has no members.");
			expect(
				(await (await recipient.request.get(endpoint)).json()).teams[0]
					.membershipIds,
			).toEqual([]);
			// The REST command and browser inventory share the same tenant membership boundary.
			expect(
				(
					await recipient.request.post(`${endpoint}/commands`, {
						headers: { Origin: origin },
						data: {
							command: {
								action: "addTeamMember",
								teamId,
								membershipId: snapshot.membership.id,
								operationKey: randomUUID(),
							},
						},
					})
				).status(),
			).toBe(200);
			await recipient.reload();
			await expect(team.getByRole("listitem")).toContainText(recipientEmail);
			await recipient.screenshot({
				path: testInfo.outputPath(
					`ownership-transfer-${outgoingRole}-desktop.png`,
				),
				fullPage: true,
			});
			await recipient.setViewportSize({ width: 390, height: 844 });
			await recipient.screenshot({
				path: testInfo.outputPath(
					`ownership-transfer-${outgoingRole}-mobile.png`,
				),
				fullPage: true,
			});
			expect(
				await recipient.evaluate(
					() => document.documentElement.scrollWidth <= innerWidth,
				),
			).toBe(true);
			await team
				.getByRole("button", { name: `Delete team ${teamName}`, exact: true })
				.click();
			await expect(team).toHaveCount(0);
			expect(
				(await (await recipient.request.get(endpoint)).json()).teams,
			).toEqual([]);
		} finally {
			await recipientContext.close();
		}
	});
}

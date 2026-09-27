import { createHmac, randomUUID } from "node:crypto";
import { createSmtpTransport, deliverIdentityEmails } from "@common-saas/email";
import { expect, type Page, test } from "@playwright/test";
import { Pool } from "pg";

const password = "Browser test password 2026!";
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
async function signUp(page: Page, email: string, entry = "/en/account") {
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

test("signup explains service outages and keeps the form available for retry", async ({
	page,
}, testInfo) => {
	let available = false;
	let requests = 0;
	let releaseRequest = () => {};
	const pendingRequest = new Promise<void>((resolve) => {
		releaseRequest = resolve;
	});
	await page.route("**/api/auth/register", async (route) => {
		requests += 1;
		await pendingRequest;
		await route.fulfill({
			status: available ? 200 : 503,
			json: available ? { status: true } : { error: "Identity unavailable" },
		});
	});
	await page.goto("/en/account");
	const submit = page.locator("form button[type=submit]");
	await page
		.getByRole("link", { name: "Create an account", exact: true })
		.click();
	await page.getByLabel("Email", { exact: true }).fill("outage@example.test");
	await page.getByLabel("Name", { exact: true }).fill("Synthetic outage test");
	await page.getByLabel("Password", { exact: true }).fill(password);
	await page.getByLabel("Confirm password", { exact: true }).fill(password);
	try {
		await submit.click();
		await expect(submit).toBeDisabled();
		await expect(page.locator("form")).toHaveAttribute("aria-busy", "true");
		await page.locator("form").evaluate((form) => {
			(form as HTMLFormElement).requestSubmit();
		});
		await page.screenshot({
			path: testInfo.outputPath("sign-up-loading.png"),
			fullPage: true,
		});
		expect(requests).toBe(1);
	} finally {
		releaseRequest();
	}
	await expect(page.getByRole("main").getByRole("alert")).toContainText(
		"Account services are temporarily unavailable. Please try again shortly.",
	);
	await expect(page.getByLabel("Email", { exact: true })).toHaveValue(
		"outage@example.test",
	);
	await expect(page.getByLabel("Password", { exact: true })).toHaveValue(
		password,
	);
	await expect(submit).toBeEnabled();
	await page.screenshot({
		path: testInfo.outputPath("sign-up-service-error.png"),
		fullPage: true,
	});
	available = true;
	await submit.click();
	await expect(page.getByRole("status")).toContainText(
		"an email is on its way",
	);
	expect(requests).toBe(2);
	await expect(
		page.getByRole("link", { name: "Back to sign-in", exact: true }),
	).toBeVisible();
	await page.screenshot({
		path: testInfo.outputPath("sign-up-email-success.png"),
		fullPage: true,
	});
});

test("redirects the local alias before registration without relaxing auth origins", async ({
	page,
	baseURL,
}) => {
	if (!baseURL) throw new Error("Missing browser origin");
	const alias = new URL("/en/account", baseURL);
	alias.hostname = alias.hostname === "localhost" ? "127.0.0.1" : "localhost";
	const redirect = await page.request.get(alias.href, { maxRedirects: 0 });
	expect(redirect.status()).toBe(307);
	expect(redirect.headers().location).toBe(
		new URL("/en/account", baseURL).href,
	);
	await signUp(page, `alias-${randomUUID()}@example.test`, alias.href);
	expect(new URL(page.url()).origin).toBe(new URL(baseURL).origin);
	const forbidden = await page.request.post(
		new URL("/api/auth/register", alias).href,
		{
			headers: { origin: alias.origin },
			data: {
				email: `forbidden-${randomUUID()}@example.test`,
				name: "Synthetic alias test",
				password,
			},
		},
	);
	expect(forbidden.status()).toBe(403);
});

async function enableVirtualAuthenticator(page: Page) {
	const client = await page.context().newCDPSession(page);
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
}

function authenticatorCode(uri: string) {
	const secret = new URL(uri).searchParams.get("secret") ?? "";
	const bits = [...secret]
		.map((character) =>
			"ABCDEFGHIJKLMNOPQRSTUVWXYZ234567"
				.indexOf(character)
				.toString(2)
				.padStart(5, "0"),
		)
		.join("");
	const key = Buffer.from(
		(bits.match(/.{8}/g) ?? []).map((byte) => Number.parseInt(byte, 2)),
	);
	const tick = Buffer.alloc(8);
	tick.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30000)));
	const digest = createHmac("sha1", key).update(tick).digest();
	return ((digest.readUInt32BE(digest[19] & 15) & 0x7fffffff) % 1000000)
		.toString()
		.padStart(6, "0");
}

async function passwordSignIn(
	page: Page,
	email: string,
	suppliedPassword: string,
) {
	await page.getByLabel("Email", { exact: true }).fill(email);
	await page.getByLabel("Password", { exact: true }).fill(suppliedPassword);
	await page.getByRole("button", { name: "Sign in", exact: true }).click();
}

test("password registration, sign-in, localized reset, and preserved MFA recovery", async ({
	page,
	browser,
}, testInfo) => {
	const email = `browser-password-${randomUUID().slice(0, 8)}@example.test`;
	const newPassword = "Replacement browser password 2026!";
	await signUp(page, email);
	await page.getByLabel("Current password", { exact: true }).fill(password);
	await page
		.getByRole("button", { name: "Set up authenticator", exact: true })
		.click();
	await expect(page.locator("code")).toContainText("otpauth://");
	const uri = await page.locator("code").innerText();
	const recoveryCodes = (await page.locator("pre").innerText())
		.trim()
		.split("\n");
	await page
		.getByLabel("Verification code", { exact: true })
		.fill(authenticatorCode(uri));
	await page.getByRole("button", { name: "Verify", exact: true }).click();
	await expect(
		page.getByRole("button", { name: "Disable authenticator", exact: true }),
	).toBeVisible();
	await page.getByRole("button", { name: "Sign out", exact: true }).click();
	await passwordSignIn(page, email, password);
	await expect(page.getByRole("main").getByRole("alert")).toContainText(
		"Complete sign-in with your authenticator",
	);
	await expect(
		page.getByRole("heading", { name: "Organizations", exact: true }),
	).toHaveCount(0);
	await page
		.getByLabel("Verification code", { exact: true })
		.fill(authenticatorCode(uri));
	await page.getByRole("button", { name: "Verify", exact: true }).click();
	await expect(
		page.getByRole("heading", { name: "Organizations", exact: true }),
	).toBeVisible();

	const resetContext = await browser.newContext();
	const reset = await resetContext.newPage();
	try {
		await reset.goto("/es/account");
		await reset
			.getByRole("link", { name: "¿Olvidaste tu contraseña?", exact: true })
			.click();
		await reset.getByLabel("Correo electrónico", { exact: true }).fill(email);
		await reset
			.getByRole("button", {
				name: "Enviar enlace para restablecer la contraseña",
				exact: true,
			})
			.click();
		await expect(reset.getByRole("status")).toContainText(
			"recibirás un correo para restablecerla",
		);
		const link = await emailLink(
			email,
			/https?:\/\/[^\s<]+\/auth\/reset-password\?token=[A-Za-z0-9_-]+(?:&locale=es)?/,
		);
		expect(new URL(link).searchParams.get("locale")).toBe("es");
		// Neither an email scanner nor rendering the form consumes the reset challenge.
		await reset.request.get(link);
		await reset.goto(link);
		await expect(reset).toHaveURL(/\/auth\/reset-password$/);
		await page.reload();
		await expect(
			page.getByRole("heading", { name: "Organizations", exact: true }),
		).toBeVisible();
		await reset
			.getByLabel("Nueva contraseña", { exact: true })
			.fill(newPassword);
		await reset
			.getByLabel("Confirmar contraseña", { exact: true })
			.fill(newPassword);
		await reset.setViewportSize({ width: 390, height: 844 });
		await reset.screenshot({
			path: testInfo.outputPath("password-reset-form-mobile.png"),
			fullPage: true,
		});
		expect(
			await reset.evaluate(
				() => document.documentElement.scrollWidth <= innerWidth,
			),
		).toBe(true);
		await reset
			.getByRole("button", { name: "Restablecer contraseña", exact: true })
			.click();
		await expect(reset.getByRole("status")).toContainText(
			"Tu contraseña se ha restablecido",
		);
		await reset.screenshot({
			path: testInfo.outputPath("password-reset-spanish.png"),
			fullPage: true,
		});
		await page.reload();
		await expect(
			page.getByRole("heading", {
				name: "Welcome back",
				exact: true,
			}),
		).toBeVisible();
		await passwordSignIn(page, email, password);
		await expect(page.getByRole("main").getByRole("alert")).toContainText(
			"Could not sign in",
		);
		await passwordSignIn(page, email, newPassword);
		await expect(page.getByRole("main").getByRole("alert")).toContainText(
			"Complete sign-in with your authenticator",
		);
		await expect(
			page.getByRole("heading", { name: "Organizations", exact: true }),
		).toHaveCount(0);
		await page.getByText("Use a recovery code", { exact: true }).click();
		await page
			.getByLabel("Recovery code", { exact: true })
			.fill(recoveryCodes[0]);
		await page
			.locator("details")
			.getByRole("button", { name: "Verify", exact: true })
			.click();
		await expect(
			page.getByRole("heading", { name: "Organizations", exact: true }),
		).toBeVisible();
		await page
			.getByLabel("Current password", { exact: true })
			.fill(newPassword);
		page.once("dialog", (dialog) => dialog.accept());
		await page
			.getByRole("button", { name: "Replace recovery codes", exact: true })
			.click();
		await expect(page.locator("pre")).not.toHaveText(recoveryCodes.join("\n"));
		await expect(page.locator("pre")).toBeVisible();
		await enableVirtualAuthenticator(page);
		await page
			.getByLabel("Passkey name", { exact: true })
			.fill("Recovery passkey");
		await page
			.getByRole("button", { name: "Add a passkey", exact: true })
			.click();
		await expect(
			page.getByText("Recovery passkey", { exact: true }),
		).toBeVisible();
		await page
			.getByLabel("Current password", { exact: true })
			.fill(newPassword);
		page.once("dialog", (dialog) => dialog.accept());
		await page
			.getByRole("button", { name: "Disable authenticator", exact: true })
			.click();
		await expect(
			page.getByRole("button", { name: "Set up authenticator", exact: true }),
		).toBeVisible();
		await reset.goto(link);
		await reset
			.getByLabel("Nueva contraseña", { exact: true })
			.fill(newPassword);
		await reset
			.getByLabel("Confirmar contraseña", { exact: true })
			.fill(newPassword);
		await reset
			.getByRole("button", { name: "Restablecer contraseña", exact: true })
			.click();
		await expect(reset.getByRole("main").getByRole("alert")).toContainText(
			"El enlace puede no ser válido o haber caducado",
		);
	} finally {
		await resetContext.close();
	}
});

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
	await page.getByLabel(`Manage member: ${email}`, { exact: true }).click();
	await page.getByRole("button", { name: "Deactivate", exact: true }).click();
	await page
		.getByRole("dialog")
		.getByRole("button", { name: "Confirm change", exact: true })
		.click();
	await expect(page.getByRole("status")).toContainText(
		"final owner cannot be deactivated",
	);
	await page
		.getByRole("dialog")
		.getByRole("button", { name: "Cancel", exact: true })
		.click();
	await page.getByRole("link", { name: "Account", exact: true }).click();
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
	await northTab.getByRole("tab", { name: "Teams", exact: true }).click();
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
}, testInfo) => {
	const id = randomUUID().slice(0, 8);
	await enableVirtualAuthenticator(page);
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
			name: "Welcome back",
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
			await page.getByRole("tab", { name: "Invitations", exact: true }).click();
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
			await page.getByRole("tab", { name: "Ownership", exact: true }).click();
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
				await page
					.getByRole("dialog")
					.getByRole("button", { name: "Confirm change", exact: true })
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
			await recipient
				.getByRole("dialog")
				.getByRole("button", { name: "Confirm change", exact: true })
				.click();
			await expect(
				recipient.getByRole("heading", {
					name: "Transfer ownership",
					exact: true,
				}),
			).toBeVisible();
			// The old owner's existing tab retains stale controls; the RPC command must still recheck authoritative ownership.
			await page.getByRole("tab", { name: "Teams", exact: true }).click();
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
			await recipient.getByRole("tab", { name: "Teams", exact: true }).click();
			const team = recipient.getByRole("article", {
				name: `Team ${teamName}`,
				exact: true,
			});
			await team.locator("summary").click();
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
			await recipient
				.getByRole("dialog")
				.getByRole("button", { name: "Confirm change", exact: true })
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
			await team.locator("summary").click();
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
			await recipient
				.getByRole("dialog")
				.getByRole("button", { name: "Confirm change", exact: true })
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

test("Project dashboard validates, edits, detects conflicts, moves and restores localized resources", async ({
	page,
	baseURL,
}, testInfo) => {
	const id = randomUUID().slice(0, 8);
	await signUp(page, `browser-project-${id}@example.test`);
	await page
		.getByLabel("Organization name", { exact: true })
		.fill(`Projects ${id}`);
	await page.getByLabel("URL name", { exact: true }).fill(`projects-${id}`);
	await page
		.getByRole("button", { name: "Create organization", exact: true })
		.click();
	await expect(
		page.getByRole("heading", { name: `Projects ${id}`, exact: true }),
	).toBeVisible();
	await page.getByRole("link", { name: "Open projects", exact: true }).click();
	await expect(
		page.getByRole("heading", { name: "Projects", exact: true }),
	).toBeVisible();
	await expect(
		page.getByText("Loading projects…", { exact: true }),
	).toHaveCount(0);
	const workspaces = page.getByRole("region", {
		name: "Workspaces",
		exact: true,
	});
	await workspaces
		.locator("summary")
		.filter({ hasText: "Create workspace" })
		.click();
	await workspaces.getByLabel("Name", { exact: true }).fill("Design studio");
	await workspaces.getByLabel("Slug", { exact: true }).fill(`design-${id}`);
	await workspaces
		.getByRole("button", { name: "Create workspace", exact: true })
		.click();
	await expect(
		workspaces.getByRole("button", { name: "Archive", exact: true }),
	).toBeVisible();
	await page.getByRole("button", { name: "New project", exact: true }).click();
	const editor = page.getByRole("region", { name: "New project", exact: true });
	await editor
		.getByRole("button", { name: "Create project", exact: true })
		.click();
	await expect(editor.getByRole("alert")).toHaveCount(2);
	await editor.getByLabel("Name", { exact: true }).fill("Website refresh");
	await editor.getByLabel("Slug", { exact: true }).fill(`website-${id}`);
	await editor
		.getByLabel("Description", { exact: true })
		.fill("Synthetic browser project");
	await editor
		.getByLabel("Workspace", { exact: true })
		.selectOption({ label: "Design studio" });
	await editor
		.getByRole("button", { name: "Create project", exact: true })
		.click();
	await expect(
		page.getByRole("heading", { name: "Website refresh", exact: true }),
	).toBeVisible();
	const card = page.getByRole("listitem").filter({
		has: page.getByRole("heading", { name: "Website refresh", exact: true }),
	});
	await card.getByRole("button", { name: "Edit", exact: true }).click();
	const editing = page.getByRole("region", {
		name: "Edit project",
		exact: true,
	});
	await editing
		.getByLabel("Description", { exact: true })
		.fill("A stale editor must not overwrite another change");
	const organizationId = new URL(page.url()).pathname.split("/")[3];
	const list = await page.request.get(
		`/api/v1/organizations/${organizationId}/projects`,
	);
	expect(list.status()).toBe(200);
	const project = (await list.json()).items[0];
	const changed = await page.request.patch(
		`/api/v1/organizations/${organizationId}/projects/${project.id}`,
		{
			headers: { origin: baseURL ?? "" },
			data: {
				version: project.version,
				description: "Concurrent server change",
			},
		},
	);
	expect(changed.status()).toBe(200);
	await editing
		.getByRole("button", { name: "Save changes", exact: true })
		.click();
	await expect(editing.getByRole("status")).toContainText(
		"This item has changed",
	);
	await editing.getByRole("button", { name: "Cancel", exact: true }).click();
	await page.getByRole("button", { name: "Refresh", exact: true }).click();
	await expect(card).toContainText("Concurrent server change");
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
	await card.locator("summary").click();
	await card
		.getByLabel("Destination for Website refresh", { exact: true })
		.selectOption("");
	await card.getByRole("button", { name: "Move", exact: true }).click();
	await expect(
		card.getByLabel("Destination for Website refresh", { exact: true }),
	).toHaveValue("");
	await expect(card.getByRole("status")).toContainText("Changes saved.");
	if (
		!(await card
			.locator("details.projects-context")
			.evaluate((element) => element.hasAttribute("open")))
	)
		await card.locator("summary").click();
	await card.getByRole("button", { name: "Delete", exact: true }).click();
	await page
		.getByRole("dialog")
		.getByRole("button", { name: "Delete project", exact: true })
		.click();
	await expect(
		page.getByRole("heading", { name: "Website refresh", exact: true }),
	).toHaveCount(0);
	await page.getByLabel("Include deleted projects", { exact: true }).check();
	await expect(
		card.getByRole("button", { name: "Restore", exact: true }),
	).toBeVisible();
	await card.getByRole("button", { name: "Restore", exact: true }).click();
	await expect(
		card.getByRole("button", { name: "Edit", exact: true }),
	).toBeVisible();
	await page
		.getByLabel("Search projects", { exact: true })
		.fill("does not match");
	await page.getByRole("button", { name: "Search", exact: true }).click();
	await expect(
		page.getByText("No accessible projects match your search.", {
			exact: true,
		}),
	).toBeVisible();
	await page.getByLabel("Search projects", { exact: true }).fill("Website");
	await page.getByRole("button", { name: "Search", exact: true }).click();
	await expect(card).toBeVisible();
	await page.getByLabel("Language", { exact: true }).selectOption("es");
	await expect(
		page.getByRole("heading", { name: "Proyectos", exact: true }),
	).toBeVisible();
	await expect(
		page.getByRole("heading", { name: "Website refresh", exact: true }),
	).toBeVisible();
	await page.screenshot({
		path: testInfo.outputPath("projects-spanish.png"),
		fullPage: true,
	});
});

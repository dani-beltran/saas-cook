import { createHmac, randomUUID } from "node:crypto";
import { runMigrations } from "@common-saas/db/migrate";
import { deliverIdentityEmails } from "@common-saas/email";
import { Pool } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createIdentityRuntime } from "./index";
import { testAuthenticator } from "./testing/webauthn";

const origin = "https://auth.example.test";
const secret = "synthetic-password-identity-secret-32-characters";
const email = "password-owner@example.test";
const password = "Synthetic original password 123!";
const replacement = "Synthetic replacement password 456!";
const adminUrl =
	process.env.TEST_DATABASE_ADMIN_URL ??
	"postgres://postgres:local_phase1@127.0.0.1:55433/postgres";
const cookies = (response: Response) =>
	response.headers
		.getSetCookie()
		.map((value) => value.split(";")[0])
		.join("; ");
const request = (path: string, body?: unknown, cookie?: string) =>
	new Request(`${origin}${path}`, {
		method: body === undefined ? "GET" : "POST",
		headers: {
			origin,
			...(body === undefined ? {} : { "content-type": "application/json" }),
			...(cookie ? { cookie } : {}),
		},
		...(body === undefined ? {} : { body: JSON.stringify(body) }),
	});
function totp(uri: string) {
	const value = new URL(uri).searchParams.get("secret") ?? "";
	const bits = [...value]
		.map((char) =>
			"ABCDEFGHIJKLMNOPQRSTUVWXYZ234567"
				.indexOf(char)
				.toString(2)
				.padStart(5, "0"),
		)
		.join("");
	const key = Buffer.from(
		(bits.match(/.{8}/g) ?? []).map((byte) => Number.parseInt(byte, 2)),
	);
	const tick = Buffer.alloc(8);
	tick.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30000)));
	const hash = createHmac("sha1", key).update(tick).digest();
	return ((hash.readUInt32BE(hash[19] & 15) & 0x7fffffff) % 1000000)
		.toString()
		.padStart(6, "0");
}

describe("email/password identity with real PostgreSQL", () => {
	const admin = new Pool({ connectionString: adminUrl });
	const dbName = `password_test_${randomUUID().replaceAll("-", "")}`;
	const publication = {
		installationId: randomUUID(),
		bindingId: randomUUID(),
		epoch: randomUUID(),
	};
	let pool: Pool;
	let worker: Pool;
	let migrator: Pool;
	let runtime: ReturnType<typeof createIdentityRuntime>;
	const url = (role: string) => {
		const target = new URL(adminUrl);
		target.pathname = `/${dbName}`;
		target.username = role;
		target.password = "local_phase1";
		return target.toString();
	};
	beforeAll(async () => {
		await admin.query(`CREATE DATABASE ${dbName} OWNER common_saas_migrator`);
		await runMigrations({ databaseUrl: url("common_saas_migrator") });
		pool = new Pool({ connectionString: url("common_saas_identity"), max: 10 });
		worker = new Pool({ connectionString: url("common_saas_worker") });
		migrator = new Pool({ connectionString: url("common_saas_migrator") });
		await migrator.query(
			"INSERT INTO foundation.installation(installation_id,binding_id,recovery_epoch) VALUES($1,$2,$3)",
			[publication.installationId, publication.bindingId, publication.epoch],
		);
		runtime = createIdentityRuntime(pool, {
			secret,
			origin,
			readiness: async () => publication,
		});
	});
	afterAll(async () => {
		// Wait for sockets to finish closing before dropping the isolated database.
		await Promise.all(
			[pool, worker, migrator].map(async (value) => {
				if (!value) return;
				let remaining = value.totalCount;
				const removed = new Promise<void>((resolve) => {
					if (!remaining) return resolve();
					const complete = () => {
						remaining--;
						if (!remaining) {
							value.off("remove", complete);
							resolve();
						}
					};
					value.on("remove", complete);
				});
				await value.end();
				await removed;
			}),
		);
		await admin.query(`DROP DATABASE IF EXISTS ${dbName}`);
		await admin.end();
	});
	beforeEach(async () => {
		await pool.query(
			'DELETE FROM identity.security_audit; DELETE FROM identity.passkey; DELETE FROM identity.two_factor; DELETE FROM identity.session; DELETE FROM identity.verification; DELETE FROM identity.account; DELETE FROM identity."user"; DELETE FROM identity.rate_limit; DELETE FROM identity.ingress_limit; DELETE FROM identity.email_delivery',
		);
	});
	async function messages() {
		const result: Array<{ text: string; html: string; subject: string }> = [];
		await deliverIdentityEmails(worker, {
			secret,
			transport: async (message) => {
				result.push(message);
			},
		});
		return result;
	}
	function emailToken(
		mail: Array<{ text: string }>,
		pathname: "/auth/confirm" | "/auth/reset-password",
	) {
		const links = mail.flatMap((message) =>
			[...message.text.matchAll(/https:\/\/auth\.example\.test\/[^\s]+/g)].map(
				(match) => new URL(match[0]),
			),
		);
		return (
			links
				.find((link) => link.pathname === pathname)
				?.searchParams.get("token") ?? undefined
		);
	}
	async function register(accountEmail = email, accountPassword?: string) {
		const response = await runtime.handler(
			request("/api/auth/register", {
				email: accountEmail,
				name: "Synthetic password owner",
				password: accountPassword,
				locale: "es",
			}),
		);
		const mail = await messages();
		return { response, token: emailToken(mail, "/auth/confirm"), mail };
	}
	async function verifiedAccount(
		accountPassword: string | undefined = password,
	) {
		const issued = await register(email, accountPassword);
		expect(issued.token).toBeTruthy();
		const response = await runtime.handler(
			request("/api/auth/confirm", { token: issued.token }),
		);
		expect(response.status).toBe(200);
		const cookie = cookies(response);
		const actor = await runtime.session(new Headers({ cookie }));
		if (!actor) throw new Error("Missing verified test account");
		return { cookie, actor };
	}
	const signIn = (accountPassword = password, accountEmail = email) =>
		runtime.handler(
			request("/api/auth/sign-in/email", {
				email: accountEmail,
				password: accountPassword,
			}),
		);
	async function resetRequest(accountEmail = email) {
		const response = await runtime.handler(
			request("/api/auth/request-password-reset", {
				email: accountEmail,
				locale: "es",
			}),
		);
		const mail = await messages();
		return { response, token: emailToken(mail, "/auth/reset-password"), mail };
	}
	const reset = (token: string | undefined, newPassword = replacement) =>
		runtime.handler(
			request("/api/auth/reset-password", { token, newPassword }),
		);

	it.each(["unavailable", "mismatched"])(
		"reports %s readiness as a service outage before accepting credentials",
		async (state) => {
			const unready = createIdentityRuntime(pool, {
				secret,
				origin,
				readiness: async () => {
					if (state === "unavailable")
						throw new Error("Independent authorization readiness required");
					return { ...publication, epoch: randomUUID() };
				},
			});
			for (const route of [
				"register",
				"sign-in/email",
				"request-password-reset",
			]) {
				const response = await unready.handler(
					request(`/api/auth/${route}`, { email, password }),
				);
				expect(response.status).toBe(503);
				expect(await response.json()).toEqual({
					error: "Identity unavailable",
				});
				expect(response.headers.get("cache-control")).toBe("no-store");
				expect(response.headers.get("referrer-policy")).toBe("no-referrer");
				expect(cookies(response)).toBe("");
			}
			expect(
				(await pool.query('SELECT id FROM identity."user"')).rowCount,
			).toBe(0);
			expect(
				(await pool.query("SELECT id FROM identity.verification")).rowCount,
			).toBe(0);
			expect(await messages()).toEqual([]);
			const retried = await register(email, password);
			expect(retried.response.status).toBe(200);
			expect(retried.mail).toHaveLength(1);
		},
	);

	it("verifies registration explicitly before password sessions and never replaces existing credentials", async () => {
		const registered = await register(email, password);
		expect(await registered.response.json()).toEqual({ status: true });
		expect(cookies(registered.response)).toBe("");
		expect(registered.mail).toHaveLength(1);
		expect(registered.mail[0].subject).toBe("Verifica tu dirección de correo");
		expect(
			JSON.stringify(
				(await pool.query("SELECT * FROM identity.verification")).rows,
			),
		).not.toContain(password);
		expect((await pool.query("SELECT id FROM identity.account")).rowCount).toBe(
			0,
		);
		expect((await signIn()).ok).toBe(false);
		expect((await pool.query("SELECT id FROM identity.session")).rowCount).toBe(
			0,
		);
		const scanner = await runtime.handler(
			request(`/auth/confirm?token=${registered.token}`),
		);
		expect(scanner.status).toBe(200);
		expect(scanner.headers.get("referrer-policy")).toBe("no-referrer");
		expect(cookies(scanner)).toBe("");
		const repeated = await register(email, replacement);
		expect(await repeated.response.json()).toEqual({ status: true });
		expect((await pool.query("SELECT id FROM identity.account")).rowCount).toBe(
			0,
		);
		expect(
			(
				await runtime.handler(
					request("/api/auth/confirm", { token: registered.token }),
				)
			).status,
		).toBe(200);
		const credential = (
			await pool.query("SELECT password FROM identity.account")
		).rows[0].password;
		expect(credential).toBeTruthy();
		expect(credential).not.toContain(password);
		const alreadyVerified = await register(email, replacement);
		expect(await alreadyVerified.response.json()).toEqual({ status: true });
		expect(
			(await pool.query("SELECT password FROM identity.account")).rows,
		).toEqual([{ password: credential }]);
		const signed = await signIn();
		expect(signed.status).toBe(200);
		expect(
			await runtime.session(new Headers({ cookie: cookies(signed) })),
		).toMatchObject({ method: "password", mfa: false, userVerified: false });
		expect((await signIn(replacement)).ok).toBe(false);
		expect(
			(
				await runtime.handler(
					request("/api/auth/sign-up/email", {
						email: "bypass@example.test",
						name: "Bypass",
						password,
					}),
				)
			).ok,
		).toBe(false);
	});
	it("never activates an attacker's pending password through the victim's generic email login", async () => {
		const attacker = await register(email, password);
		await runtime.handler(request("/api/auth/sign-in/magic-link", { email }));
		const victimToken = emailToken(await messages(), "/auth/confirm");
		expect(victimToken).toBeTruthy();
		const victim = await runtime.handler(
			request("/api/auth/confirm", { token: victimToken }),
		);
		expect(victim.status).toBe(200);
		expect(
			await runtime.session(new Headers({ cookie: cookies(victim) })),
		).toMatchObject({ method: "magic-link", mfa: false });
		expect((await pool.query("SELECT id FROM identity.account")).rowCount).toBe(
			0,
		);
		expect((await signIn()).ok).toBe(false);
		await runtime.handler(
			request("/api/auth/confirm", { token: attacker.token }),
		);
		expect((await pool.query("SELECT id FROM identity.account")).rowCount).toBe(
			0,
		);
		expect((await signIn()).ok).toBe(false);
	});
	it("enforces password bounds and hides unknown users behind the same invalid-credentials response", async () => {
		for (const invalid of ["short", "a".repeat(129)]) {
			expect((await register(email, invalid)).response.status).toBe(400);
			expect(
				(await pool.query('SELECT id FROM identity."user"')).rowCount,
			).toBe(0);
		}
		await verifiedAccount();
		const wrong = await signIn("Wrong synthetic password");
		const unknown = await signIn(password, "unknown@example.test");
		expect(wrong.status).toBe(unknown.status);
		expect(wrong.ok).toBe(false);
		expect(await wrong.json()).toEqual(await unknown.json());
		expect(cookies(wrong)).toBe("");
		const foreign = request("/api/auth/sign-in/email", { email, password });
		foreign.headers.set("origin", "https://evil.test");
		expect((await runtime.handler(foreign)).status).toBe(403);
	});
	it("uses hashed, single-use reset tokens, revokes all sessions and requires a fresh login", async () => {
		const first = await verifiedAccount();
		const second = await signIn();
		const secondCookie = cookies(second);
		await runtime.handler(request("/api/auth/sign-in/magic-link", { email }));
		const outstandingLink = emailToken(await messages(), "/auth/confirm");
		const issued = await resetRequest();
		expect(issued.token).toBeTruthy();
		expect(
			cookies(
				await runtime.handler(
					request("/api/auth/confirm", { token: issued.token }),
				),
			),
		).toBe("");
		const unknown = await resetRequest("unknown@example.test");
		expect(await issued.response.json()).toEqual(await unknown.response.json());
		expect(unknown.mail).toHaveLength(0);
		const persisted = JSON.stringify(
			(await pool.query("SELECT * FROM identity.verification")).rows,
		);
		expect(persisted).not.toContain(issued.token);
		const scanner = await runtime.handler(
			request(`/auth/reset-password?token=${issued.token}`),
		);
		expect(cookies(scanner)).toBe("");
		expect((await reset(issued.token, "short")).ok).toBe(false);
		const results = await Promise.all([
			reset(issued.token),
			reset(issued.token),
		]);
		expect(results.filter((result) => result.ok)).toHaveLength(1);
		for (const result of results) expect(cookies(result)).toBe("");
		for (const cookie of [first.cookie, secondCookie])
			expect(await runtime.session(new Headers({ cookie }))).toBeNull();
		expect(
			cookies(
				await runtime.handler(
					request("/api/auth/confirm", { token: outstandingLink }),
				),
			),
		).toBe("");
		await expect(runtime.assertCurrent(first.actor)).rejects.toThrow();
		expect((await pool.query("SELECT id FROM identity.session")).rowCount).toBe(
			0,
		);
		expect((await signIn()).ok).toBe(false);
		const fresh = await signIn(replacement);
		expect(fresh.status).toBe(200);
		expect(
			await runtime.session(new Headers({ cookie: cookies(fresh) })),
		).toMatchObject({ method: "password", mfa: false, credentialEpoch: 2 });
	});
	it("rejects expired resets and resets issued for an earlier credential epoch", async () => {
		await verifiedAccount();
		const expired = await resetRequest();
		await pool.query(
			"UPDATE identity.verification SET expires_at=now()-interval '1 second'",
		);
		expect((await reset(expired.token)).ok).toBe(false);
		const first = await resetRequest();
		const second = await resetRequest();
		expect(first.token).toBeTruthy();
		expect(second.token).toBeTruthy();
		expect((await reset(second.token)).ok).toBe(true);
		expect((await reset(first.token, password)).ok).toBe(false);
		expect((await signIn(replacement)).status).toBe(200);
	});
	it("rechecks reset expiry after waiting for the user fence without revoking valid sessions", async () => {
		const account = await verifiedAccount();
		const issued = await resetRequest();
		const transaction = await pool.connect();
		try {
			await transaction.query("BEGIN");
			await transaction.query(
				"SELECT pg_advisory_xact_lock_shared(hashtextextended('user:'||$1,0))",
				[account.actor.userId],
			);
			const resetting = reset(issued.token);
			await expect
				.poll(
					async () =>
						(
							await pool.query(
								"SELECT count(*)::int AS count FROM pg_locks WHERE locktype='advisory' AND database=(SELECT oid FROM pg_database WHERE datname=current_database()) AND NOT granted",
							)
						).rows[0].count,
				)
				.toBeGreaterThan(0);
			await pool.query(
				"UPDATE identity.verification SET expires_at=clock_timestamp()-interval '1 millisecond'",
			);
			await transaction.query("COMMIT");
			expect((await resetting).ok).toBe(false);
			await runtime.assertCurrent(account.actor);
			expect(
				await runtime.session(new Headers({ cookie: account.cookie })),
			).toMatchObject({ credentialEpoch: 1 });
			expect((await signIn()).status).toBe(200);
		} finally {
			await transaction.query("ROLLBACK");
			transaction.release();
		}
	});
	it("does not reset unverified identities or convert passwordless accounts", async () => {
		await register(email, password);
		const unverified = await resetRequest();
		expect(await unverified.response.json()).toEqual({ status: true });
		expect(unverified.mail).toHaveLength(0);
		const magicEmail = "magic-only@example.test";
		const magic = await register(magicEmail);
		await runtime.handler(request("/api/auth/confirm", { token: magic.token }));
		const passwordless = await resetRequest(magicEmail);
		expect(await passwordless.response.json()).toEqual({ status: true });
		expect(passwordless.mail).toHaveLength(0);
		expect(
			(
				await pool.query(
					'SELECT a.id FROM identity.account a JOIN identity."user" u ON u.id=a.user_id WHERE u.email=$1',
					[magicEmail],
				)
			).rowCount,
		).toBe(0);
	});
	it("denies password sign-in and previously issued resets while the identity is frozen", async () => {
		const account = await verifiedAccount();
		const issued = await resetRequest();
		await pool.query(
			"UPDATE identity.\"user\" SET lifecycle_status='frozen' WHERE id=$1",
			[account.actor.userId],
		);
		expect((await signIn()).ok).toBe(false);
		expect((await reset(issued.token)).ok).toBe(false);
		const frozen = await resetRequest();
		expect(await frozen.response.json()).toEqual({ status: true });
		expect(frozen.mail).toHaveLength(0);
		expect(
			await runtime.session(new Headers({ cookie: account.cookie })),
		).toBeNull();
	});
	it("keeps MFA and one-use recovery enforced through password login, reset and factor management", async () => {
		await verifiedAccount();
		const signed = await signIn();
		const signedCookie = cookies(signed);
		const missingPassword = await runtime.handler(
			request("/api/auth/two-factor/enable", {}, signedCookie),
		);
		expect(missingPassword.ok).toBe(false);
		const wrongPassword = await runtime.handler(
			request(
				"/api/auth/two-factor/enable",
				{ password: replacement },
				signedCookie,
			),
		);
		expect(wrongPassword.ok).toBe(false);
		const enabled = await runtime.handler(
			request("/api/auth/two-factor/enable", { password }, signedCookie),
		);
		expect(enabled.status).toBe(200);
		const setup = (await enabled.json()) as {
			totpURI: string;
			backupCodes: string[];
		};
		const enrolled = await runtime.handler(
			request(
				"/api/auth/two-factor/verify-totp",
				{ code: totp(setup.totpURI) },
				signedCookie,
			),
		);
		expect(enrolled.status).toBe(200);
		const pending = cookies(await signIn());
		expect(await runtime.session(new Headers({ cookie: pending }))).toBeNull();
		expect(
			await runtime.session(new Headers({ cookie: pending }), {
				allowPendingMfa: true,
			}),
		).toMatchObject({ method: "password", mfa: false });
		expect(
			(
				await runtime.handler(
					request("/api/auth/list-sessions", undefined, pending),
				)
			).ok,
		).toBe(false);
		const verified = await runtime.handler(
			request(
				"/api/auth/two-factor/verify-totp",
				{ code: totp(setup.totpURI) },
				pending,
			),
		);
		expect(verified.status).toBe(200);
		const mfaCookie = cookies(verified) || pending;
		expect(
			await runtime.session(new Headers({ cookie: mfaCookie })),
		).toMatchObject({ method: "totp", mfa: true });
		await runtime.handler(request("/api/auth/sign-in/magic-link", { email }));
		const pendingToken = emailToken(await messages(), "/auth/confirm");
		const outstandingPending = cookies(
			await runtime.handler(
				request("/api/auth/confirm", { token: pendingToken }),
			),
		);
		const issued = await resetRequest();
		expect((await reset(issued.token)).status).toBe(200);
		expect(
			await runtime.session(new Headers({ cookie: mfaCookie })),
		).toBeNull();
		const resetLogin = await signIn(replacement);
		expect(resetLogin.status).toBe(200);
		const afterReset = cookies(resetLogin);
		expect(
			await runtime.session(new Headers({ cookie: outstandingPending }), {
				allowPendingMfa: true,
			}),
		).toBeNull();
		expect(
			await runtime.session(new Headers({ cookie: afterReset })),
		).toBeNull();
		const recovered = await runtime.handler(
			request(
				"/api/auth/two-factor/verify-backup-code",
				{ code: setup.backupCodes[0] },
				afterReset,
			),
		);
		expect(recovered.status).toBe(200);
		const recoveredCookie = cookies(recovered) || afterReset;
		expect(
			await runtime.session(new Headers({ cookie: recoveredCookie })),
		).toMatchObject({ method: "recovery", mfa: true, credentialEpoch: 2 });
		expect(
			(
				await runtime.handler(
					request(
						"/api/auth/two-factor/verify-backup-code",
						{ code: setup.backupCodes[0] },
						recoveredCookie,
					),
				)
			).ok,
		).toBe(false);
		const regenerated = await runtime.handler(
			request(
				"/api/auth/two-factor/generate-backup-codes",
				{ password: replacement },
				recoveredCookie,
			),
		);
		expect(regenerated.status).toBe(200);
		const optionsResponse = await runtime.handler(
			request(
				"/api/auth/passkey/generate-register-options",
				undefined,
				recoveredCookie,
			),
		);
		const options = await optionsResponse.json();
		const authenticator = testAuthenticator();
		const passkey = await runtime.handler(
			request(
				"/api/auth/passkey/verify-registration",
				{
					response: authenticator.register(
						options.challenge,
						origin,
						options.rp.id,
					),
				},
				`${recoveredCookie}; ${cookies(optionsResponse)}`,
			),
		);
		expect(passkey.status).toBe(200);
		const disabled = await runtime.handler(
			request(
				"/api/auth/two-factor/disable",
				{ password: replacement },
				recoveredCookie,
			),
		);
		expect(disabled.status).toBe(200);
	});
	it("drains an in-flight user fence and rejects old-password sign-in queued behind reset", async () => {
		const account = await verifiedAccount();
		await runtime.handler(request("/api/auth/sign-in/magic-link", { email }));
		const pendingLink = emailToken(await messages(), "/auth/confirm");
		const issued = await resetRequest();
		const transaction = await pool.connect();
		try {
			await transaction.query("BEGIN");
			await transaction.query(
				"SELECT pg_advisory_xact_lock_shared(hashtextextended('user:'||$1,0))",
				[account.actor.userId],
			);
			let completed = false;
			const resetting = reset(issued.token).then((response) => {
				completed = true;
				return response;
			});
			await expect
				.poll(
					async () =>
						(
							await pool.query(
								"SELECT count(*)::int AS count FROM pg_locks WHERE locktype='advisory' AND database=(SELECT oid FROM pg_database WHERE datname=current_database()) AND NOT granted",
							)
						).rows[0].count,
				)
				.toBeGreaterThan(0);
			const oldPasswordLogin = signIn();
			const oldEmailLogin = runtime.handler(
				request("/api/auth/confirm", { token: pendingLink }),
			);
			await expect
				.poll(
					async () =>
						(
							await pool.query(
								"SELECT count(*)::int AS count FROM pg_locks WHERE locktype='advisory' AND database=(SELECT oid FROM pg_database WHERE datname=current_database()) AND NOT granted",
							)
						).rows[0].count,
				)
				.toBeGreaterThan(2);
			expect(completed).toBe(false);
			await runtime.assertCurrent(account.actor);
			await transaction.query("COMMIT");
			expect((await resetting).status).toBe(200);
			expect((await oldPasswordLogin).ok).toBe(false);
			expect(cookies(await oldEmailLogin)).toBe("");
			expect(
				(await pool.query("SELECT id FROM identity.session")).rowCount,
			).toBe(0);
			await expect(runtime.assertCurrent(account.actor)).rejects.toThrow();
		} finally {
			await transaction.query("ROLLBACK");
			transaction.release();
		}
	});
});

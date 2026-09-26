import { spawn } from "node:child_process";
import { createHmac, randomUUID } from "node:crypto";
import { runMigrations } from "@common-saas/db/migrate";
import {
	createSmtpTransport,
	deliverIdentityEmails,
	enqueueIdentityEmail,
} from "@common-saas/email";
import { Pool } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createIdentityRuntime } from "./index";
import { testAuthenticator } from "./testing/webauthn";

const origin = "https://auth.example.test";
const secret = "synthetic-phase2-identity-secret-32-characters";
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
describe("production identity with real PostgreSQL and SMTP", () => {
	const admin = new Pool({ connectionString: adminUrl });
	const dbName = `identity_test_${randomUUID().replaceAll("-", "")}`;
	const publication = {
		installationId: randomUUID(),
		bindingId: randomUUID(),
		epoch: randomUUID(),
	};
	let pool: Pool;
	let worker: Pool;
	let migrator: Pool;
	let runtime: ReturnType<typeof createIdentityRuntime>;
	let token: string;
	let userId: string;
	let signedInCookie: string;
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
		await Promise.all([pool?.end(), worker?.end(), migrator?.end()]);
		await admin.query(`DROP DATABASE IF EXISTS ${dbName} WITH(FORCE)`);
		await admin.end();
	});
	async function issue(
		email = "owner@example.test",
		path = "/api/auth/sign-in/magic-link",
	) {
		const result = await runtime.handler(
			request(path, { email, name: "Synthetic owner", locale: "es" }),
		);
		const messages: Array<{ text: string; html: string; subject: string }> = [];
		await deliverIdentityEmails(worker, {
			secret,
			transport: async (message) => {
				messages.push(message);
			},
		});
		const link = messages
			.at(-1)
			?.text.match(
				/https:\/\/auth\.example\.test\/auth\/confirm\?token=([A-Za-z0-9_-]+)/,
			);
		return { result, token: link?.[1] ?? "", messages };
	}
	beforeEach(async () => {
		await pool.query(
			'DELETE FROM identity.security_audit; DELETE FROM identity.passkey; DELETE FROM identity.two_factor; DELETE FROM identity.session; DELETE FROM identity.verification; DELETE FROM identity.account; DELETE FROM identity."user"; DELETE FROM identity.rate_limit; DELETE FROM identity.ingress_limit; DELETE FROM identity.email_delivery',
		);
		const issued = await issue("owner@example.test", "/api/auth/register");
		token = issued.token;
		expect(token.length).toBeGreaterThan(20);
		const signed = await runtime.handler(
			request("/api/auth/confirm", { token, destination: "/en/account" }),
		);
		expect(signed.status).toBe(200);
		signedInCookie = cookies(signed);
		userId =
			(await runtime.session(new Headers({ cookie: signedInCookie })))
				?.userId ?? "";
		expect(userId).not.toBe("");
	});
	async function register(
		authenticator = testAuthenticator(),
		name = "Device",
	) {
		const optionsResponse = await runtime.handler(
			request(
				"/api/auth/passkey/generate-register-options",
				undefined,
				signedInCookie,
			),
		);
		expect(optionsResponse.status).toBe(200);
		const options = await optionsResponse.json();
		const result = await runtime.handler(
			request(
				"/api/auth/passkey/verify-registration",
				{
					response: authenticator.register(
						options.challenge,
						origin,
						options.rp.id,
					),
					name,
				},
				`${signedInCookie}; ${cookies(optionsResponse)}`,
			),
		);
		expect(result.status).toBe(200);
		return {
			authenticator,
			credential: (await result.json()) as { id: string },
		};
	}
	async function authenticate(
		authenticator: ReturnType<typeof testAuthenticator>,
		fault?: string,
	) {
		const optionsResponse = await runtime.handler(
			request("/api/auth/passkey/generate-authenticate-options"),
		);
		expect(optionsResponse.status).toBe(200);
		const options = await optionsResponse.json();
		const assertion = authenticator.authenticate(
			fault === "challenge" ? "wrong" : options.challenge,
			fault === "origin" ? "https://evil.test" : origin,
			fault === "rp" ? "evil.test" : options.rpId,
			fault !== "uv",
		);
		if (fault === "signature")
			assertion.response.signature = Buffer.from("bad").toString("base64url");
		const req = () =>
			request(
				"/api/auth/passkey/verify-authentication",
				{ response: assertion },
				cookies(optionsResponse),
			);
		return {
			result: await runtime.handler(req()),
			replay: () => runtime.handler(req()),
		};
	}
	it("uses generic requests, hashes tokens, prevents implicit signup, and has non-consuming scanner GETs", async () => {
		const known = await issue();
		const unknown = await issue("unknown@example.test");
		expect(await known.result.json()).toEqual(await unknown.result.json());
		expect(
			JSON.stringify(
				(await pool.query("SELECT * FROM identity.verification")).rows,
			),
		).not.toContain(known.token);
		const scanner = await runtime.handler(
			request(`/auth/confirm?token=${known.token}`),
		);
		expect(scanner.status).toBe(200);
		expect(scanner.headers.get("referrer-policy")).toBe("no-referrer");
		expect(
			(
				await runtime.handler(
					request(`/api/auth/magic-link/verify?token=${known.token}`),
				)
			).status,
		).toBe(405);
		const invalid = await runtime.handler(
			request("/api/auth/confirm", {
				token: known.token,
				destination: "//evil.test",
			}),
		);
		expect(invalid.status).toBe(400);
		const wrongOrigin = request("/api/auth/confirm", { token: known.token });
		wrongOrigin.headers.set("origin", "https://evil.test");
		expect((await runtime.handler(wrongOrigin)).status).toBe(403);
		const success = await runtime.handler(
			request("/api/auth/confirm", { token: known.token }),
		);
		expect(cookies(success)).not.toBe("");
		const unknownConfirm = await runtime.handler(
			request("/api/auth/confirm", { token: unknown.token }),
		);
		expect(cookies(unknownConfirm)).toBe("");
		expect((await pool.query('SELECT * FROM identity."user"')).rowCount).toBe(
			1,
		);
		expect(
			cookies(
				await runtime.handler(
					request("/api/auth/confirm", { token: known.token }),
				),
			),
		).toBe("");
	});
	it("atomically consumes links across concurrent adapters and expires them", async () => {
		const issued = await issue();
		const script = `
   import { Pool } from 'pg';
   import {createIdentityRuntime} from ${JSON.stringify(new URL("./index.ts", import.meta.url).href)};
   process.once('message', ({databaseUrl,publication,secret,origin})=>{
    const pool=new Pool({connectionString:databaseUrl});
    const runtime=createIdentityRuntime(pool,{secret,origin,readiness:async()=>publication});
    process.once('message',async({token})=>{
     try {
      const response=await runtime.handler(new Request(origin+'/api/auth/confirm',{method:'POST',headers:{origin,'content-type':'application/json'},body:JSON.stringify({token})}));
      process.send({consumed:response.headers.getSetCookie().length>0});
     }finally{await pool.end();process.disconnect();}
    });
    process.send({ready:true});
   });`;
		const children = Array.from({ length: 4 }, () =>
			spawn(
				process.execPath,
				["--import", "tsx", "--input-type=module", "-e", script],
				{ stdio: ["ignore", "ignore", "ignore", "ipc"] },
			),
		);
		try {
			const prepared = await Promise.all(
				children.map(
					(child) =>
						new Promise<{ result: Promise<boolean> }>((resolve) => {
							child.once("message", () => {
								const result = new Promise<boolean>((done, reject) => {
									child.once("message", (message: { consumed: boolean }) =>
										done(message.consumed),
									);
									child.once("error", reject);
									child.once("exit", (code) => {
										if (code !== 0)
											reject(new Error("Identity replica failed"));
									});
								});
								resolve({ result });
							});
							child.send({
								databaseUrl: url("common_saas_identity"),
								publication,
								secret,
								origin,
							});
						}),
				),
			);
			for (const child of children) child.send({ token: issued.token });
			const consumed = await Promise.all(prepared.map((value) => value.result));
			expect(consumed.filter(Boolean)).toHaveLength(1);
		} finally {
			for (const child of children) child.kill();
		}
		const expired = await issue();
		await pool.query(
			"UPDATE identity.verification SET expires_at=now()-interval '1 second'",
		);
		expect(
			cookies(
				await runtime.handler(
					request("/api/auth/confirm", { token: expired.token }),
				),
			),
		).toBe("");
	});
	it("denies frozen identities, changed credential epochs, and independent recovery epoch mismatch", async () => {
		const issued = await issue();
		await pool.query(
			"UPDATE identity.\"user\" SET lifecycle_status='frozen' WHERE id=$1",
			[userId],
		);
		expect(
			await runtime.session(new Headers({ cookie: signedInCookie })),
		).toBeNull();
		expect(
			cookies(
				await runtime.handler(
					request("/api/auth/confirm", { token: issued.token }),
				),
			),
		).toBe("");
		await pool.query(
			"UPDATE identity.\"user\" SET lifecycle_status='active',credential_epoch=2 WHERE id=$1",
			[userId],
		);
		expect(
			await runtime.session(new Headers({ cookie: signedInCookie })),
		).toBeNull();
		const fresh = await issue();
		const response = await runtime.handler(
			request("/api/auth/confirm", { token: fresh.token }),
		);
		expect(
			(await runtime.session(new Headers({ cookie: cookies(response) })))
				?.credentialEpoch,
		).toBe(2);
		const mismatched = createIdentityRuntime(pool, {
			secret,
			origin,
			readiness: async () => ({ ...publication, epoch: randomUUID() }),
		});
		await expect(
			mismatched.session(new Headers({ cookie: cookies(response) })),
		).rejects.toThrow("recovery");
	});
	it("registers multiple passkeys and propagates only verified UV into durable fresh assurance", async () => {
		const first = await register();
		const signed = await authenticate(first.authenticator);
		signedInCookie = cookies(signed.result);
		await register(testAuthenticator(), "Backup");
		expect(signed.result.status).toBe(200);
		const actor = await runtime.session(
			new Headers({ cookie: cookies(signed.result) }),
		);
		expect(actor).toMatchObject({
			method: "passkey",
			mfa: true,
			userVerified: true,
		});
		expect((await signed.replay()).ok).toBe(false);
		const deleted = await runtime.handler(
			request(
				"/api/auth/revoke-passkey",
				{ id: first.credential.id },
				cookies(signed.result),
			),
		);
		expect(deleted.status).toBe(200);
		expect((await authenticate(first.authenticator)).result.ok).toBe(false);
		const remaining = (
			await pool.query("SELECT id FROM identity.passkey WHERE user_id=$1", [
				userId,
			])
		).rows[0];
		expect(
			(
				await runtime.handler(
					request(
						"/api/auth/revoke-passkey",
						{ id: remaining.id },
						cookies(signed.result),
					),
				)
			).status,
		).toBe(400);
	});
	it("enforces server-verified UV at enrollment and challenge expiry at sign-in", async () => {
		const authenticator = testAuthenticator();
		const registration = await runtime.handler(
			request(
				"/api/auth/passkey/generate-register-options",
				undefined,
				signedInCookie,
			),
		);
		const options = await registration.json();
		const unverified = await runtime.handler(
			request(
				"/api/auth/passkey/verify-registration",
				{
					response: authenticator.register(
						options.challenge,
						origin,
						options.rp.id,
						false,
					),
				},
				`${signedInCookie}; ${cookies(registration)}`,
			),
		);
		expect(unverified.ok).toBe(false);
		expect((await pool.query("SELECT * FROM identity.passkey")).rowCount).toBe(
			0,
		);
		await register(authenticator);
		const authentication = await runtime.handler(
			request("/api/auth/passkey/generate-authenticate-options"),
		);
		const challenge = await authentication.json();
		await pool.query(
			"UPDATE identity.verification SET expires_at=now()-interval '1 second'",
		);
		const expired = await runtime.handler(
			request(
				"/api/auth/passkey/verify-authentication",
				{
					response: authenticator.authenticate(
						challenge.challenge,
						origin,
						challenge.rpId,
					),
				},
				cookies(authentication),
			),
		);
		expect(expired.ok).toBe(false);
		expect((await pool.query("SELECT * FROM identity.session")).rowCount).toBe(
			1,
		);
	});
	it("rejects stale enrollment and applies generic durable identity rate limits", async () => {
		await pool.query(
			"UPDATE identity.session SET authenticated_at=now()-interval '10 minutes'",
		);
		expect(
			(
				await runtime.handler(
					request(
						"/api/auth/passkey/generate-register-options",
						undefined,
						signedInCookie,
					),
				)
			).ok,
		).toBe(false);
		const responses = await Promise.all(
			Array.from({ length: 12 }, () =>
				runtime.handler(
					request("/api/auth/sign-in/magic-link", {
						email: "owner@example.test",
					}),
				),
			),
		);
		for (const response of responses)
			expect(await response.json()).toEqual({ status: true });
		expect(
			(
				await pool.query(
					"SELECT count(*)::int AS count FROM identity.verification",
				)
			).rows[0].count,
		).toBeLessThanOrEqual(4);
	});

	it.each(["origin", "rp", "challenge", "signature", "uv"])(
		"rejects passkey %s failures",
		async (fault) => {
			const registered = await register();
			expect(
				(await authenticate(registered.authenticator, fault)).result.ok,
			).toBe(false);
			expect(
				(await pool.query("SELECT * FROM identity.session")).rowCount,
			).toBe(1);
		},
	);
	it("enrolls passwordless TOTP, requires MFA after magic login, accepts recovery once", async () => {
		const enabled = await runtime.handler(
			request("/api/auth/two-factor/enable", {}, signedInCookie),
		);
		expect(enabled.status).toBe(200);
		const setup = (await enabled.json()) as {
			totpURI: string;
			backupCodes: string[];
		};
		const totpSecret = new URL(setup.totpURI).searchParams.get("secret") ?? "";
		const bits = [...totpSecret]
			.map((char) =>
				"ABCDEFGHIJKLMNOPQRSTUVWXYZ234567"
					.indexOf(char)
					.toString(2)
					.padStart(5, "0"),
			)
			.join("");
		const totpKey = Buffer.from(
			(bits.match(/.{8}/g) ?? []).map((byte) => Number.parseInt(byte, 2)),
		);
		const tick = Buffer.alloc(8);
		tick.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30000)));
		const hash = createHmac("sha1", totpKey).update(tick).digest();
		const offset = hash[19] & 15;
		const code = ((hash.readUInt32BE(offset) & 0x7fffffff) % 1000000)
			.toString()
			.padStart(6, "0");
		const verified = await runtime.handler(
			request("/api/auth/two-factor/verify-totp", { code }, signedInCookie),
		);
		expect(verified.status).toBe(200);
		const rotated = cookies(verified) || signedInCookie;
		expect((await runtime.session(new Headers({ cookie: rotated })))?.mfa).toBe(
			true,
		);
		const issued = await issue();
		const emailOnly = await runtime.handler(
			request("/api/auth/confirm", { token: issued.token }),
		);
		const pending = cookies(emailOnly);
		expect(await runtime.session(new Headers({ cookie: pending }))).toBeNull();
		expect(
			await runtime.session(new Headers({ cookie: pending }), {
				allowPendingMfa: true,
			}),
		).toMatchObject({ mfa: false });
		const recovery = await runtime.handler(
			request(
				"/api/auth/two-factor/verify-backup-code",
				{ code: setup.backupCodes[0] },
				pending,
			),
		);
		expect(recovery.status).toBe(200);
		expect(
			(await runtime.session(new Headers({ cookie: pending })))?.method,
		).toBe("recovery");
		expect(
			(
				await runtime.handler(
					request(
						"/api/auth/two-factor/verify-backup-code",
						{ code: setup.backupCodes[0] },
						pending,
					),
				)
			).ok,
		).toBe(false);
		signedInCookie = pending;
		await register();
		const assuranceBefore = await runtime.session(
			new Headers({ cookie: pending }),
		);
		const disabled = await runtime.handler(
			request("/api/auth/two-factor/disable", {}, pending),
		);
		expect(disabled.status).toBe(200);
		const assuranceAfter = await runtime.session(
			new Headers({ cookie: cookies(disabled) }),
		);
		expect(assuranceAfter?.authenticatedAt.getTime()).toBe(
			assuranceBefore?.authenticatedAt.getTime(),
		);
	});
	it("drains a fenced in-flight request before session revocation and rejects the original immutable actor afterwards", async () => {
		const actor = await runtime.session(
			new Headers({ cookie: signedInCookie }),
		);
		if (!actor) throw new Error("Missing test session");
		const transaction = await pool.connect();
		try {
			await transaction.query("BEGIN");
			await transaction.query(
				"SELECT pg_advisory_xact_lock_shared(hashtextextended('user:'||$1,0))",
				[actor.userId],
			);
			await runtime.assertCurrent(actor);
			let completed = false;
			const revoked = runtime
				.handler(request("/api/auth/sign-out", {}, signedInCookie))
				.then((response) => {
					completed = true;
					return response;
				});
			await expect
				.poll(
					async () =>
						(
							await pool.query(
								"SELECT count(*)::int AS count FROM pg_locks WHERE locktype='advisory' AND NOT granted",
							)
						).rows[0].count,
				)
				.toBeGreaterThan(0);
			expect(completed).toBe(false);
			await runtime.assertCurrent(actor);
			await transaction.query("COMMIT");
			expect((await revoked).status).toBe(200);
			await expect(runtime.assertCurrent(actor)).rejects.toThrow(
				"Session no longer active",
			);
			expect(
				await runtime.session(new Headers({ cookie: signedInCookie })),
			).toBeNull();
		} finally {
			await transaction.query("ROLLBACK");
			transaction.release();
		}
	});
	it("cannot add a replacement passkey using email alone after the first verified factor exists", async () => {
		await register();
		const optionsResponse = await runtime.handler(
			request(
				"/api/auth/passkey/generate-register-options",
				undefined,
				signedInCookie,
			),
		);
		const options = await optionsResponse.json();
		const other = testAuthenticator();
		const denied = await runtime.handler(
			request(
				"/api/auth/passkey/verify-registration",
				{ response: other.register(options.challenge, origin, options.rp.id) },
				`${signedInCookie}; ${cookies(optionsResponse)}`,
			),
		);
		expect(denied.ok).toBe(false);
		expect((await pool.query("SELECT * FROM identity.passkey")).rowCount).toBe(
			1,
		);
	});

	it("encrypts every identity email journey, retries failed deliveries and submits real SMTP", async () => {
		for (const kind of [
			"verification",
			"reset",
			"magic-link",
			"invite",
			"transfer",
			"transfer-completed",
			"recovery",
		] as const)
			await enqueueIdentityEmail(pool, {
				secret,
				to: "synthetic@example.test",
				kind,
				locale: "en",
				url: `${origin}/auth/confirm?token=synthetic-private-token`,
				expiresAt: new Date(Date.now() + 300000),
			});
		const stored = JSON.stringify(
			(await pool.query("SELECT * FROM identity.email_delivery")).rows,
		);
		expect(stored).not.toContain("synthetic-private-token");
		expect(stored).not.toContain("synthetic@example.test");
		const first = await deliverIdentityEmails(worker, {
			secret,
			transport: async () => {
				throw new Error("synthetic provider outage");
			},
		});
		expect(first.failed).toBe(7);
		await worker.query(
			"UPDATE identity.email_delivery SET available_at=now() WHERE delivered_at IS NULL",
		);
		const delivered = await deliverIdentityEmails(worker, {
			secret,
			transport: createSmtpTransport({
				host: "127.0.0.1",
				port: 1026,
				from: "noreply@example.test",
			}),
		});
		expect(delivered.delivered).toBe(7);
		expect(
			(
				await worker.query(
					"SELECT encrypted_payload FROM identity.email_delivery WHERE delivered_at IS NOT NULL",
				)
			).rows.every((row) => row.encrypted_payload === ""),
		).toBe(true);
	});
});

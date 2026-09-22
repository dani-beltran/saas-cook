import { fork, type ChildProcess } from "node:child_process";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { initializeProviderSchema, makeProvider, origin } from "./provider";
import { testAuthenticator } from "./webauthn-fixture";

const enabled = process.env.PHASE0_INTEGRATION === "1";
const integration = enabled ? describe : describe.skip;
const cookies = (response: Response) => response.headers.getSetCookie().map((cookie) => cookie.split(";")[0]).join("; ");
const request = (path: string, body?: unknown, cookie?: string) => new Request(`${origin}${path}`, { method: body === undefined ? "GET" : "POST", headers: { origin, ...(body === undefined ? {} : { "content-type": "application/json" }), ...(cookie ? { cookie } : {}) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });

integration("pinned Better Auth + Drizzle + real PostgreSQL adapter", () => {
  const provider = makeProvider();
  const permissiveProvider = makeProvider({ enforceUserVerification: false });
  let userId: string;
  let signedInCookie: string;

  beforeAll(async () => { await initializeProviderSchema(provider.pool); });
  afterAll(async () => { await Promise.all([provider.pool.end(), permissiveProvider.pool.end()]); });
  beforeEach(async () => {
    await provider.pool.query('TRUNCATE identity_spike."user", identity_spike.session, identity_spike.account, identity_spike.verification, identity_spike.passkey');
    provider.delivered.length = 0;
    provider.frozenUsers.clear();
    const context = await provider.auth.$context;
    const user = await context.internalAdapter.createUser({ name: "Synthetic owner", email: "owner@example.test", emailVerified: true }, { method: "phase0-fixture" });
    userId = user.id;
    await provider.auth.api.signInMagicLink({ body: { email: user.email }, headers: new Headers({ origin }) });
    const response = await provider.auth.api.magicLinkVerify({ query: { token: provider.delivered.at(-1)!.token }, headers: new Headers({ origin }), asResponse: true });
    expect(response.status).toBe(200);
    signedInCookie = cookies(response);
    provider.delivered.length = 0;
  });

  async function issue(email = "owner@example.test") {
    const response = await provider.handler(request("/api/auth/sign-in/magic-link", { email, callbackURL: "/app" }));
    return { response, delivery: provider.delivered.at(-1)! };
  }

  async function registrationOptions(cookie = signedInCookie) {
    const response = await provider.handler(request("/api/auth/passkey/generate-register-options", undefined, cookie));
    expect(response.status).toBe(200);
    const body = await response.json() as { challenge: string; rp: { id: string }; authenticatorSelection: { userVerification: string } };
    return { ...body, cookie: `${cookie}; ${cookies(response)}` };
  }

  async function register(authenticator = testAuthenticator(), name = "Synthetic device") {
    const options = await registrationOptions();
    const response = await provider.handler(request("/api/auth/passkey/verify-registration", { response: authenticator.register(options.challenge, origin, options.rp.id), name }, options.cookie));
    expect(response.status).toBe(200);
    return { authenticator, credential: await response.json() as { id: string } };
  }

  async function authenticationOptions() {
    const response = await provider.handler(request("/api/auth/passkey/generate-authenticate-options"));
    expect(response.status).toBe(200);
    return { ...await response.json() as { challenge: string; rpId: string; userVerification: string }, cookie: cookies(response) };
  }

  it("stores a hash, returns generic requests for known/unknown identities and disables implicit signup", async () => {
    const known = await issue();
    const unknown = await issue("unknown@example.test");
    expect(await known.response.json()).toEqual(await unknown.response.json());
    expect(known.response.status).toBe(200);
    const rows = await provider.pool.query<{ identifier: string; value: string }>("SELECT identifier,value FROM identity_spike.verification");
    expect(rows.rows).toHaveLength(2);
    expect(JSON.stringify(rows.rows)).not.toContain(known.delivery.token);
    expect(JSON.stringify(rows.rows)).not.toContain(unknown.delivery.token);
    expect(known.delivery.token.length).toBeGreaterThanOrEqual(32);
    const response = await provider.auth.api.magicLinkVerify({ query: { token: unknown.delivery.token }, headers: new Headers({ origin }), asResponse: true });
    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toContain("new_user_signup_disabled");
    expect((await provider.pool.query('SELECT id FROM identity_spike."user"')).rowCount).toBe(1);
  });

  it("scanner GETs cannot consume a token and explicit same-origin POST consumes once", async () => {
    const { delivery } = await issue();
    const scanner = await provider.handler(new Request(delivery.url));
    expect(scanner.status).toBe(200);
    expect(scanner.headers.get("referrer-policy")).toBe("no-referrer");
    expect(scanner.headers.get("cache-control")).toBe("no-store");
    expect((await provider.pool.query("SELECT id FROM identity_spike.verification")).rowCount).toBe(1);
    const direct = await provider.handler(request(`/api/auth/magic-link/verify?token=${delivery.token}`));
    expect(direct.status).toBe(405);
    expect((await provider.auth.handler(request(`/api/auth/magic-link/verify?token=${delivery.token}`))).status).toBe(404);
    const confirm = () => provider.handler(request("/auth/confirm", { token: delivery.token, destination: "/app/acme" }));
    const accepted = await confirm();
    expect(accepted.status).toBe(302);
    expect(accepted.headers.get("location")).toBe(`${origin}/app/acme`);
    expect(accepted.headers.getSetCookie().length).toBeGreaterThan(0);
    expect(accepted.headers.get("referrer-policy")).toBe("no-referrer");
    expect((await confirm()).headers.get("location")).toContain("INVALID_TOKEN");
  });

  it("rejects cross-origin confirmations and unsafe destinations before consuming", async () => {
    const { delivery } = await issue();
    const malicious = new Request(`${origin}/auth/confirm`, { method: "POST", headers: { origin: "https://evil.test", "content-type": "application/json" }, body: JSON.stringify({ token: delivery.token }) });
    expect((await provider.handler(malicious)).status).toBe(403);
    expect((await provider.handler(request("/auth/confirm", { token: delivery.token, destination: "//evil.test" }))).status).toBe(400);
    expect((await provider.pool.query("SELECT id FROM identity_spike.verification")).rowCount).toBe(1);
  });

  it("expires tokens and denies new sessions for an account frozen after issuance", async () => {
    const { delivery } = await issue();
    await provider.pool.query('UPDATE identity_spike.verification SET "expiresAt" = now() - interval \'1 second\'');
    const expired = await provider.auth.api.magicLinkVerify({ query: { token: delivery.token }, headers: new Headers({ origin }), asResponse: true });
    expect(expired.headers.get("location")).toContain("INVALID_TOKEN");
    const fresh = await issue();
    provider.frozenUsers.add(userId);
    const frozen = await provider.auth.api.magicLinkVerify({ query: { token: fresh.delivery.token }, headers: new Headers({ origin }), asResponse: true });
    expect(frozen.status).toBe(403);
    expect((await provider.pool.query("SELECT id FROM identity_spike.session")).rowCount).toBe(1);
  });

  it("atomically redeems one token across four independent Node processes", async () => {
    const { delivery } = await issue();
    const replicas: ChildProcess[] = [];
    try {
      const prepared = await Promise.all(Array.from({ length: 4 }, () => new Promise<{ child: ChildProcess; result: Promise<boolean> }>((resolve, reject) => {
        const child = fork(fileURLToPath(new URL("./replica.ts", import.meta.url)), [], { execArgv: ["--import", "tsx"], stdio: ["ignore", "ignore", "pipe", "ipc"] });
        replicas.push(child);
        let stderr = "";
        child.stderr?.on("data", (chunk: Buffer) => { stderr += chunk.toString(); });
        child.on("error", reject);
        child.on("exit", (code) => { if (code !== 0) reject(new Error(`Replica failed (${code}): ${stderr}`)); });
        child.once("message", () => {
          const result = new Promise<boolean>((resolveResult, rejectResult) => {
            child.once("message", (message: { consumed: boolean }) => resolveResult(message.consumed));
            child.once("error", rejectResult);
            child.once("exit", (code) => { if (code !== 0) rejectResult(new Error(`Replica failed (${code})`)); });
          });
          resolve({ child, result });
        });
      })));
      for (const { child } of prepared) child.send({ token: delivery.token });
      const consumed = await Promise.all(prepared.map(({ result }) => result));
      expect(consumed.filter(Boolean)).toHaveLength(1);
      expect((await provider.pool.query("SELECT id FROM identity_spike.session")).rowCount).toBe(2);
      expect((await provider.pool.query("SELECT id FROM identity_spike.verification")).rowCount).toBe(0);
    } finally { for (const child of replicas) child.kill(); }
  });

  it("registers multiple named public credentials, signs in, and prevents challenge replay", async () => {
    const { authenticator } = await register();
    await register(testAuthenticator(), "Backup device");
    const listed = await provider.handler(request("/api/auth/passkey/list-user-passkeys", undefined, signedInCookie));
    const credentials = await listed.json() as Array<{ name: string }>;
    expect(credentials.map((credential) => credential.name).sort()).toEqual(["Backup device", "Synthetic device"]);
    const options = await authenticationOptions();
    const body = { response: authenticator.authenticate(options.challenge, origin, options.rpId) };
    const signIn = await provider.handler(request("/api/auth/passkey/verify-authentication", body, options.cookie));
    expect(signIn.status).toBe(200);
    expect((await signIn.json() as { user: { id: string } }).user.id).toBe(userId);
    expect((await provider.handler(request("/api/auth/passkey/verify-authentication", body, options.cookie))).status).toBe(400);
    const stored = (await provider.pool.query('SELECT "publicKey",counter FROM identity_spike.passkey WHERE "credentialID"=$1', [authenticator.id])).rows[0];
    expect(stored.counter).toBe(1);
    expect(stored.publicKey).toBeTypeOf("string");
  });

  it.each(["origin", "rp", "challenge", "signature", "uv"])("rejects genuine signed fixtures with invalid %s", async (fault) => {
    const { authenticator } = await register();
    const options = await authenticationOptions();
    const assertion = authenticator.authenticate(fault === "challenge" ? "incorrect-challenge" : options.challenge, fault === "origin" ? "https://evil.test" : origin, fault === "rp" ? "evil.test" : options.rpId, fault !== "uv");
    if (fault === "signature") assertion.response.signature = Buffer.from("invalid-signature").toString("base64url");
    const result = await provider.handler(request("/api/auth/passkey/verify-authentication", { response: assertion }, options.cookie));
    expect(result.status).toBe(fault === "uv" ? 403 : 400);
    expect((await provider.pool.query("SELECT id FROM identity_spike.session")).rowCount).toBe(1);
  });

  it("demonstrates the pinned plugin accepts no-UV assertions without the server hook", async () => {
    const { authenticator } = await register();
    const options = await authenticationOptions();
    // Regression evidence for the adapter gap: preference is not enforcement.
    expect(options.userVerification).toBe("preferred");
    const assertion = authenticator.authenticate(options.challenge, origin, options.rpId, false);
    const result = await permissiveProvider.handler(request("/api/auth/passkey/verify-authentication", { response: assertion }, options.cookie));
    expect(result.status).toBe(200);
  });

  it("requires a session for enrollment and rejects enrollment without verified UV", async () => {
    expect((await provider.handler(request("/api/auth/passkey/generate-register-options"))).status).toBe(401);
    const options = await registrationOptions();
    expect(options.authenticatorSelection.userVerification).toBe("required");
    const response = testAuthenticator().register(options.challenge, origin, options.rp.id, false);
    expect((await provider.handler(request("/api/auth/passkey/verify-registration", { response }, options.cookie))).status).toBe(403);
    expect((await provider.pool.query("SELECT id FROM identity_spike.passkey")).rowCount).toBe(0);
  });

  it("rejects expired WebAuthn challenges", async () => {
    const { authenticator } = await register();
    const options = await authenticationOptions();
    await provider.pool.query('UPDATE identity_spike.verification SET "expiresAt" = now() - interval \'1 second\'');
    const assertion = authenticator.authenticate(options.challenge, origin, options.rpId);
    expect((await provider.handler(request("/api/auth/passkey/verify-authentication", { response: assertion }, options.cookie))).status).toBe(400);
  });

  it("blocks public direct deletion and verifies adapter credential revocation separately", async () => {
    const { authenticator, credential } = await register();
    expect((await provider.handler(request("/api/auth/passkey/delete-passkey", { id: credential.id }, signedInCookie))).status).toBe(405);
    expect((await provider.handler(request("/api/auth/delete-user", {}, signedInCookie))).status).toBe(405);
    expect((await provider.handler(request("/api/auth/delete-user/callback?token=anything", undefined, signedInCookie))).status).toBe(405);
    // Direct internal API here proves provider deletion only; the policy model
    // separately tests fresh assurance and final-credential recovery requirements.
    await provider.auth.api.deletePasskey({ body: { id: credential.id }, headers: new Headers({ cookie: signedInCookie, origin }) });
    const options = await authenticationOptions();
    const response = authenticator.authenticate(options.challenge, origin, options.rpId);
    expect((await provider.handler(request("/api/auth/passkey/verify-authentication", { response }, options.cookie))).status).toBe(401);
  });
});

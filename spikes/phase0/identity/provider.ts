import { passkey } from "@better-auth/passkey";
import { betterAuth } from "better-auth";
import { APIError } from "better-auth/api";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { magicLink } from "better-auth/plugins";
import { drizzle } from "drizzle-orm/node-postgres";
import { boolean, integer, pgSchema, text, timestamp } from "drizzle-orm/pg-core";
import { Pool } from "pg";
import { safeDestination } from "./assurance.ts";

export const origin = "https://auth.example.test";
export const databaseUrl = process.env.PHASE0_DATABASE_URL ?? "postgresql://postgres:phase0@127.0.0.1:55432/phase0";
const namespace = pgSchema("identity_spike");
const dates = () => ({ createdAt: timestamp("createdAt", { withTimezone: true }).notNull(), updatedAt: timestamp("updatedAt", { withTimezone: true }).notNull() });
const user = namespace.table("user", { id: text("id").primaryKey(), name: text("name").notNull(), email: text("email").notNull().unique(), emailVerified: boolean("emailVerified").notNull(), image: text("image"), ...dates() });
const session = namespace.table("session", { id: text("id").primaryKey(), userId: text("userId").notNull().references(() => user.id), token: text("token").notNull().unique(), expiresAt: timestamp("expiresAt", { withTimezone: true }).notNull(), ipAddress: text("ipAddress"), userAgent: text("userAgent"), ...dates() });
const account = namespace.table("account", { id: text("id").primaryKey(), userId: text("userId").notNull().references(() => user.id), accountId: text("accountId").notNull(), providerId: text("providerId").notNull(), accessToken: text("accessToken"), refreshToken: text("refreshToken"), idToken: text("idToken"), accessTokenExpiresAt: timestamp("accessTokenExpiresAt", { withTimezone: true }), refreshTokenExpiresAt: timestamp("refreshTokenExpiresAt", { withTimezone: true }), scope: text("scope"), password: text("password"), ...dates() });
const verification = namespace.table("verification", { id: text("id").primaryKey(), identifier: text("identifier").notNull(), value: text("value").notNull(), expiresAt: timestamp("expiresAt", { withTimezone: true }).notNull(), ...dates() });
const passkeyCredential = namespace.table("passkey", { id: text("id").primaryKey(), name: text("name"), publicKey: text("publicKey").notNull(), userId: text("userId").notNull().references(() => user.id), credentialID: text("credentialID").notNull().unique(), counter: integer("counter").notNull(), deviceType: text("deviceType").notNull(), backedUp: boolean("backedUp").notNull(), transports: text("transports"), createdAt: timestamp("createdAt", { withTimezone: true }), aaguid: text("aaguid") });
const schema = { user, session, account, verification, passkey: passkeyCredential };

export function makeProvider(options: { enforceUserVerification?: boolean } = {}) {
  const pool = new Pool({ connectionString: databaseUrl, max: 4, connectionTimeoutMillis: 5_000 });
  const delivered: Array<{ email: string; token: string; url: string }> = [];
  const frozenUsers = new Set<string>();
  const auth = betterAuth({
    database: drizzleAdapter(drizzle(pool, { schema }), { provider: "pg", schema, transaction: true }),
    baseURL: origin,
    // Synthetic local test secret, not deployment configuration.
    secret: "phase0-only-synthetic-test-secret-32-characters",
    trustedOrigins: [origin],
    disabledPaths: ["/magic-link/verify", "/delete-user", "/delete-user/callback", "/passkey/delete-passkey"],
    user: { deleteUser: { enabled: false } },
    account: { accountLinking: { enabled: false } },
    rateLimit: { enabled: false }, // Load throttling has its own Phase 2 ingress tests.
    logger: { disabled: true },
    databaseHooks: {
      session: { create: { before: async (data) => {
        if (frozenUsers.has(data.userId)) throw new APIError("FORBIDDEN", { message: "account_unavailable" });
        return { data };
      } } },
    },
    plugins: [
      magicLink({
        storeToken: "hashed", expiresIn: 300, disableSignUp: true,
        sendMagicLink: async ({ email, token }) => {
          // A protected in-memory delivery fixture; never a durable ordinary job payload.
          delivered.push({ email, token, url: `${origin}/auth/confirm?token=${encodeURIComponent(token)}` });
        },
      }),
      passkey({
        rpID: "auth.example.test", rpName: "Phase 0 identity spike", origin,
        authenticatorSelection: { userVerification: "required" },
        registration: { afterVerification: async ({ verification }) => {
          if (options.enforceUserVerification !== false && !verification.registrationInfo?.userVerified)
            throw new APIError("FORBIDDEN", { message: "user_verification_required" });
        } },
        authentication: { afterVerification: async ({ verification }) => {
          if (options.enforceUserVerification !== false && !verification.authenticationInfo.userVerified)
            throw new APIError("FORBIDDEN", { message: "user_verification_required" });
        } },
      }),
    ],
  });

  async function handler(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (["/api/auth/magic-link/verify", "/api/auth/delete-user", "/api/auth/delete-user/callback", "/api/auth/passkey/delete-passkey"].includes(url.pathname))
      return new Response("Domain command required", { status: 405 });
    if (url.pathname === "/auth/confirm") {
      const headers = { "Cache-Control": "no-store", "Referrer-Policy": "no-referrer", "Content-Security-Policy": "default-src 'none'; frame-ancestors 'none'" };
      if (request.method === "GET") return new Response("Explicit sign-in confirmation required", { headers });
      if (request.method !== "POST" || request.headers.get("origin") !== origin || !request.headers.get("content-type")?.startsWith("application/json"))
        return new Response("Forbidden", { status: 403, headers });
      let input: unknown;
      try { input = await request.json(); }
      catch { return new Response("Invalid confirmation", { status: 400, headers }); }
      if (!input || typeof input !== "object" || !("token" in input) || typeof input.token !== "string")
        return new Response("Invalid confirmation", { status: 400, headers });
      let callbackURL = "/app";
      try {
        if ("destination" in input) {
          if (typeof input.destination !== "string") throw new Error("unsafe_redirect");
          callbackURL = safeDestination(input.destination, origin);
        }
      } catch { return new Response("Unsafe destination", { status: 400, headers }); }
      const result = await auth.api.magicLinkVerify({ query: { token: input.token, callbackURL }, headers: request.headers, asResponse: true });
      const responseHeaders = new Headers(result.headers);
      for (const [name, value] of Object.entries(headers)) responseHeaders.set(name, value);
      return new Response(result.body, { status: result.status, headers: responseHeaders });
    }
    return auth.handler(request);
  }

  return { auth, pool, delivered, frozenUsers, handler };
}

/** Dedicated disposable schema only; never apply this fixture to application data. */
export async function initializeProviderSchema(pool: Pool) {
  await pool.query(`
    CREATE SCHEMA IF NOT EXISTS identity_spike;
    CREATE TABLE IF NOT EXISTS identity_spike."user" (id text PRIMARY KEY, name text NOT NULL, email text NOT NULL UNIQUE, "emailVerified" boolean NOT NULL, image text, "createdAt" timestamptz NOT NULL, "updatedAt" timestamptz NOT NULL);
    CREATE TABLE IF NOT EXISTS identity_spike.session (id text PRIMARY KEY, "userId" text NOT NULL REFERENCES identity_spike."user"(id), token text NOT NULL UNIQUE, "expiresAt" timestamptz NOT NULL, "ipAddress" text, "userAgent" text, "createdAt" timestamptz NOT NULL, "updatedAt" timestamptz NOT NULL);
    CREATE TABLE IF NOT EXISTS identity_spike.account (id text PRIMARY KEY, "userId" text NOT NULL REFERENCES identity_spike."user"(id), "accountId" text NOT NULL, "providerId" text NOT NULL, "accessToken" text, "refreshToken" text, "idToken" text, "accessTokenExpiresAt" timestamptz, "refreshTokenExpiresAt" timestamptz, scope text, password text, "createdAt" timestamptz NOT NULL, "updatedAt" timestamptz NOT NULL);
    CREATE TABLE IF NOT EXISTS identity_spike.verification (id text PRIMARY KEY, identifier text NOT NULL, value text NOT NULL, "expiresAt" timestamptz NOT NULL, "createdAt" timestamptz NOT NULL, "updatedAt" timestamptz NOT NULL);
    CREATE INDEX IF NOT EXISTS identity_verification_identifier ON identity_spike.verification(identifier);
    CREATE TABLE IF NOT EXISTS identity_spike.passkey (id text PRIMARY KEY, name text, "publicKey" text NOT NULL, "userId" text NOT NULL REFERENCES identity_spike."user"(id), "credentialID" text NOT NULL UNIQUE, counter integer NOT NULL, "deviceType" text NOT NULL, "backedUp" boolean NOT NULL, transports text, "createdAt" timestamptz, aaguid text);
  `);
}

import { scim } from "@better-auth/scim";
import { betterAuth } from "better-auth";
import { getMigrations } from "better-auth/db/migration";
import { Pool } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { databaseUrl, origin } from "./provider";

const integration = process.env.PHASE0_INTEGRATION === "1" ? describe : describe.skip;
const token = (connection: string) => `phase0-synthetic-scim-bearer-${connection}-32-characters`;

integration("pinned SCIM provider mapping probe (PostgreSQL/Kysely, not domain lifecycle)", () => {
  const pool = new Pool({ connectionString: databaseUrl, options: "-c search_path=identity_scim_spike", max: 3, connectionTimeoutMillis: 5_000 });
  const subjects = new Map<string, string>();
  let rejectReconciliation = false;
  const auth = betterAuth({
    database: pool,
    baseURL: origin,
    secret: "phase0-only-synthetic-test-secret-32-characters",
    logger: { disabled: true },
    rateLimit: { enabled: false },
    account: { accountLinking: { enabled: false } },
    plugins: [
      { id: "domain-mapping-probe", schema: { directoryAccess: { fields: { userId: { type: "string", required: true }, organizationId: { type: "string", required: true }, active: { type: "boolean", required: true } } } } },
      scim({
        connections: ["a", "b"].map((id) => ({ id, provisioningDomainId: `org-${id}`, credentials: [{ type: "bearer" as const, id: `credential-${id}`, token: token(id) }] })),
        identity: {
          resolveUser: async (input) => {
            const userId = subjects.get(JSON.stringify([input.connectionId, input.resource.externalId]));
            return userId ? { action: "link" as const, userId, profile: "preserve" as const } : { action: "create" as const };
          },
          reconcileUser: async (state, { database }) => {
            // A provider transaction probe, NOT the production membership service:
            // its purpose is to prove per-source data and rollback are available.
            const prior = await database.findMany<{ id: string; organizationId: string }>({ model: "directoryAccess", where: [{ field: "userId", value: state.userId }] });
            const domains = new Set([...prior.map((row) => row.organizationId), ...state.sources.map((source) => source.provisioningDomainId)]);
            for (const organizationId of domains) {
              const active = state.sources.some((source) => source.provisioningDomainId === organizationId && source.active);
              const existing = prior.find((row) => row.organizationId === organizationId);
              if (existing) await database.update({ model: "directoryAccess", where: [{ field: "id", value: existing.id }], update: { active } });
              else await database.create({ model: "directoryAccess", data: { userId: state.userId, organizationId, active } });
            }
            if (rejectReconciliation) throw new Error("synthetic-domain-rejection");
          },
        },
      }),
    ],
  });
  let userId: string;
  beforeAll(async () => {
    await pool.query("CREATE SCHEMA IF NOT EXISTS identity_scim_spike");
    const migrations = await getMigrations(auth.options);
    await migrations.runMigrations();
  });
  afterAll(async () => { await pool.end(); });
  beforeEach(async () => {
    // Names originate in the fixed disposable schema, never request data.
    const tables = await pool.query<{ tablename: string }>("SELECT tablename FROM pg_tables WHERE schemaname = 'identity_scim_spike'");
    await pool.query(`TRUNCATE ${tables.rows.map(({ tablename }) => `identity_scim_spike."${tablename.replaceAll('"', '""')}"`).join(", ")} CASCADE`);
    rejectReconciliation = false;
    subjects.clear();
    const context = await auth.$context;
    const user = await context.internalAdapter.createUser({ name: "Multi-org person", email: "person@example.test", emailVerified: true }, { method: "phase0-fixture" });
    userId = user.id;
    for (const connection of ["a", "b"]) subjects.set(JSON.stringify([connection, "directory-subject"]), userId);
    await context.internalAdapter.createSession(userId);
  });

  const call = (connection: string, method: string, path: string, body?: unknown) => auth.handler(new Request(`${origin}/api/auth/scim/v2${path}`, { method, headers: { authorization: `Bearer ${token(connection)}`, "content-type": "application/scim+json" }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }));
  async function create(connection: string, externalId = "directory-subject") {
    return call(connection, "POST", "/Users", { schemas: ["urn:ietf:params:scim:schemas:core:2.0:User"], externalId, userName: "person@example.test", name: { formatted: "Directory display name" }, emails: [{ value: "person@example.test", primary: true }], active: true });
  }
  async function createId(connection: string) {
    const response = await create(connection);
    expect(response.status).toBe(201);
    return (await response.json() as { id: string }).id;
  }
  const deactivate = (connection: string, id: string) => call(connection, "PATCH", `/Users/${id}`, { schemas: ["urn:ietf:params:scim:api:messages:2.0:PatchOp"], Operations: [{ op: "replace", path: "active", value: false }] });

  it("explicitly maps the same immutable subject in two connections and isolates reads", async () => {
    const a = await createId("a");
    await createId("b");
    expect((await call("b", "GET", `/Users/${a}`)).status).toBe(404);
    const access = await pool.query('SELECT "organizationId",active FROM "directoryAccess" ORDER BY "organizationId"');
    expect(access.rows).toEqual([{ organizationId: "org-a", active: true }, { organizationId: "org-b", active: true }]);
    expect((await pool.query('SELECT name FROM "user"')).rows).toEqual([{ name: "Multi-org person" }]);
  });

  it("does not link an unknown subject just because the email matches", async () => {
    const response = await create("a", "unmapped-subject");
    expect(response.status).toBe(409);
    expect((await pool.query('SELECT id FROM "scimUser"')).rowCount).toBe(0);
    expect((await pool.query('SELECT id FROM "user"')).rowCount).toBe(1);
  });

  it("deactivates one organization while another source remains active", async () => {
    const a = await createId("a");
    const b = await createId("b");
    expect((await deactivate("a", a)).status).toBe(200);
    expect((await pool.query('SELECT "organizationId",active FROM "directoryAccess" ORDER BY "organizationId"')).rows).toEqual([{ organizationId: "org-a", active: false }, { organizationId: "org-b", active: true }]);
    expect((await pool.query("SELECT id FROM session")).rowCount).toBe(1);
    expect((await deactivate("b", b)).status).toBe(200);
    // Provider invalidates global sessions when its final SCIM source is inactive.
    // It preserves the global user and does not implement our global lifecycle.
    expect((await pool.query("SELECT id FROM session")).rowCount).toBe(0);
    expect((await pool.query('SELECT id FROM "user"')).rowCount).toBe(1);
  });

  it("rolls back both SCIM state and the transaction-bound domain projection when a callback rejects", async () => {
    const a = await createId("a");
    rejectReconciliation = true;
    const response = await deactivate("a", a);
    expect(response.status).toBeGreaterThanOrEqual(400);
    expect((await pool.query('SELECT active FROM "scimUser"')).rows).toEqual([{ active: true }]);
    expect((await pool.query('SELECT active FROM "directoryAccess"')).rows).toEqual([{ active: true }]);
    expect((await pool.query("SELECT id FROM session")).rowCount).toBe(1);
  });

  it("SCIM deletion preserves the global user and stable subject recreation links the same identity", async () => {
    const a = await createId("a");
    expect((await call("a", "DELETE", `/Users/${a}`)).status).toBe(204);
    expect((await pool.query('SELECT id FROM "user"')).rows).toEqual([{ id: userId }]);
    expect((await pool.query('SELECT active FROM "directoryAccess"')).rows).toEqual([{ active: false }]);
    await createId("a");
    expect((await pool.query('SELECT "userId" FROM "scimUser"')).rows).toEqual([{ userId }]);
  });
});

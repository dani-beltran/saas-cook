import { describe, expect, it } from "vitest";
import { LifecycleModel } from "./lifecycle";

async function fixture(capacity = 4) {
  const model = new LifecycleModel();
  for (const id of ["alice", "bob", "carol", "dave"]) model.users.set(id, { id, status: "active", verified: true });
  await model.bootstrap("org-a", "alice", capacity);
  return model;
}

const evidence = { independentAuthority: true, freshMfa: true, evidenceId: "independent-case-1" };

describe("Phase 0 lifecycle decision model; mutexes are not SQL lock evidence", () => {
  it("refuses unusable bootstrap without leaving organization, capacity or audit state", async () => {
    const model = await fixture();
    const audits = model.audit.length;
    await expect(model.bootstrap("org-b", "bob", 0)).rejects.toThrow("capacity_exceeded");
    expect(model.organizations.has("org-b")).toBe(false);
    expect(model.audit).toHaveLength(audits);
  });

  it("serializes two voluntary demotions so one active owner remains", async () => {
    const model = await fixture();
    await model.admit("org-a", "bob", "invitation");
    model.member("org-a", "bob").role = "owner"; // Fixture setup, not a domain command.
    const results = await Promise.allSettled([model.demote("org-a", "alice"), model.demote("org-a", "bob")]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect([...model.members.values()].filter((member) => member.active && member.role === "owner")).toHaveLength(1);
  });

  it("security offboarding revokes the sole owner during FGA outage and releases once", async () => {
    const model = await fixture();
    await model.bootstrap("org-b", "alice", 1);
    model.fgaAvailable = false;
    await Promise.all([model.securityDeactivate("org-a", "alice"), model.securityDeactivate("org-a", "alice")]);
    expect(model.member("org-a", "alice").active).toBe(false);
    expect(model.organizations.get("org-a")).toMatchObject({ status: "owner_recovery_required", occupied: 0 });
    expect(model.users.get("alice")?.status).toBe("active");
    expect(model.canUseTenant("org-b", "alice")).toBe(true);
    expect(model.audit.filter((item) => item.action === "security_deactivate")).toHaveLength(1);
    expect(model.outbox).toEqual(model.audit);
  });

  it("keeps recovery gated until the admitted replacement's revision is published", async () => {
    const model = await fixture();
    await model.securityDeactivate("org-a", "alice");
    await expect(model.recoverOwner("org-a", "bob", { ...evidence, freshMfa: false }, async () => true)).rejects.toThrow("recovery_evidence_required");
    await model.recoverOwner("org-a", "bob", evidence, async () => {
      expect(model.canUseTenant("org-a", "bob")).toBe(false);
      return true;
    });
    expect(model.canUseTenant("org-a", "bob")).toBe(true);
    expect(model.canUseTenant("org-a", "alice")).toBe(false);
    expect(model.organizations.get("org-a")?.occupied).toBe(1);
  });

  it("does not reopen after failed or stale recovery publication", async () => {
    const model = await fixture();
    await model.securityDeactivate("org-a", "alice");
    await model.recoverOwner("org-a", "bob", evidence, async () => false);
    expect(model.canUseTenant("org-a", "bob")).toBe(false);
    await expect(model.recoverOwner("org-a", "carol", evidence, async () => {
      await model.securityDeactivate("org-a", "carol");
      return true;
    })).rejects.toThrow("stale_recovery_publication");
    expect(model.organizations.get("org-a")?.status).toBe("owner_recovery_required");
  });

  it("checks recovery capacity before admitting the replacement", async () => {
    const model = await fixture(2);
    await model.admit("org-a", "bob", "invitation");
    await model.securityDeactivate("org-a", "alice");
    model.organizations.get("org-a")!.capacity = 1;
    await expect(model.recoverOwner("org-a", "carol", evidence, async () => true)).rejects.toThrow("capacity_exceeded");
    expect(model.organizations.get("org-a")?.occupied).toBe(1);
    expect(model.members.has(JSON.stringify(["org-a", "carol"]))).toBe(false);
  });

  it.each(["scim", "reactivation"] as const)("invitation versus %s competes for exactly one remaining seat", async (source) => {
    const model = await fixture(2);
    const results = await Promise.allSettled([model.admit("org-a", "bob", "invitation"), model.admit("org-a", "carol", source)]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(model.organizations.get("org-a")?.occupied).toBe(2);
    expect(model.audit).toHaveLength(2);
    expect(model.outbox).toEqual(model.audit);
  });

  it("acceptance changes both roles with one receipt and no additional seat", async () => {
    const model = await fixture(2);
    await model.admit("org-a", "bob", "invitation");
    await model.nominate({ id: "transfer", organizationId: "org-a", from: "alice", to: "bob", expiresAt: 100 });
    await expect(model.accept("transfer", "carol", 1)).rejects.toThrow("recipient_required");
    await Promise.all([model.accept("transfer", "bob", 1), model.accept("transfer", "bob", 1)]);
    expect(model.member("org-a", "alice").role).toBe("member");
    expect(model.member("org-a", "bob").role).toBe("owner");
    expect(model.organizations.get("org-a")?.occupied).toBe(2);
    expect(model.audit.filter((receipt) => receipt.action === "transfer_accepted")).toHaveLength(1);
    expect(model.outbox).toEqual(model.audit);
  });

  it("rejects cross-tenant recipients, unverified identities and duplicate outgoing transfers", async () => {
    const model = await fixture();
    await model.bootstrap("org-b", "bob", 3);
    const transfer = { id: "transfer", organizationId: "org-a", from: "alice", to: "bob", expiresAt: 100 };
    await expect(model.nominate(transfer)).rejects.toThrow("membership_missing");
    await model.admit("org-a", "bob", "invitation");
    model.users.get("bob")!.verified = false;
    await expect(model.nominate(transfer)).rejects.toThrow("invalid_transfer_parties");
    model.users.get("bob")!.verified = true;
    await model.nominate(transfer);
    await expect(model.nominate({ ...transfer, id: "duplicate" })).rejects.toThrow("transfer_pending");
  });

  it.each(["expired", "canceled", "version", "inactive"])("rejects %s acceptance without partial role/audit effects", async (failure) => {
    const model = await fixture();
    await model.admit("org-a", "bob", "invitation");
    await model.nominate({ id: "transfer", organizationId: "org-a", from: "alice", to: "bob", expiresAt: 100 });
    if (failure === "canceled") model.transfers.get("transfer")!.status = "canceled";
    if (failure === "version") model.organizations.get("org-a")!.ownerVersion += 1;
    if (failure === "inactive") await model.securityDeactivate("org-a", "bob");
    const audits = model.audit.length;
    await expect(model.accept("transfer", "bob", failure === "expired" ? 100 : 1)).rejects.toThrow();
    expect(model.member("org-a", "alice").role).toBe("owner");
    expect(model.audit).toHaveLength(audits);
  });

  it.each([true, false])("recipient deprovisioning and acceptance are safe in both orderings: %s", async (deactivateFirst) => {
    const model = await fixture();
    await model.admit("org-a", "bob", "invitation");
    await model.nominate({ id: "transfer", organizationId: "org-a", from: "alice", to: "bob", expiresAt: 100 });
    const tasks = [() => model.securityDeactivate("org-a", "bob"), () => model.accept("transfer", "bob", 1)];
    if (!deactivateFirst) tasks.reverse();
    await Promise.allSettled(tasks.map((task) => task()));
    expect(model.canUseTenant("org-a", "bob")).toBe(false);
    expect(model.organizations.get("org-a")?.occupied).toBe(1);
    if (model.transfers.get("transfer")?.status === "accepted") expect(model.organizations.get("org-a")?.status).toBe("owner_recovery_required");
    else expect(model.member("org-a", "alice").role).toBe("owner");
  });

  it("freezes globally only after every organization has ownership continuity", async () => {
    const model = await fixture();
    await model.bootstrap("org-b", "alice", 3);
    await model.admit("org-a", "bob", "invitation");
    model.member("org-a", "bob").role = "owner";
    await expect(model.freeze("alice")).rejects.toThrow("unresolved_ownership");
    expect(model.users.get("alice")?.status).toBe("active");
    await model.admit("org-b", "carol", "invitation");
    model.member("org-b", "carol").role = "owner";
    await model.freeze("alice");
    expect(model.canUseTenant("org-a", "alice")).toBe(false);
    expect(model.canUseTenant("org-b", "alice")).toBe(false);
    await Promise.all([model.securityDeactivate("org-a", "alice"), model.securityDeactivate("org-a", "alice")]);
    expect(model.organizations.get("org-a")?.occupied).toBe(1);
    expect(model.canUseTenant("org-a", "bob")).toBe(true);
  });

  it.each(["invitation", "scim"] as const)("freeze races %s admission without reviving a frozen account", async (source) => {
    const model = await fixture();
    await Promise.allSettled([model.freeze("bob"), model.admit("org-a", "bob", source)]);
    expect(model.users.get("bob")?.status).toBe("frozen");
    expect(model.members.has(JSON.stringify(["org-a", "bob"]))).toBe(false);
    await expect(model.admit("org-a", "bob", source)).rejects.toThrow("account_unavailable");
  });

  it.each([true, false])("freeze races incoming transfer acceptance with continuity in either order: %s", async (freezeFirst) => {
    const model = await fixture();
    await model.admit("org-a", "bob", "invitation");
    await model.nominate({ id: "transfer", organizationId: "org-a", from: "alice", to: "bob", expiresAt: 100 });
    const tasks = [() => model.freeze("bob"), () => model.accept("transfer", "bob", 1)];
    if (!freezeFirst) tasks.reverse();
    await Promise.allSettled(tasks.map((task) => task()));
    if (model.users.get("bob")?.status === "frozen") {
      expect(model.transfers.get("transfer")?.status).toBe("canceled");
      expect(model.member("org-a", "alice").role).toBe("owner");
    } else {
      expect(model.transfers.get("transfer")?.status).toBe("accepted");
      expect(model.member("org-a", "bob").role).toBe("owner");
    }
  });

  it("reciprocal transfers complete without reversing user/organization lock order", async () => {
    const model = await fixture();
    await model.bootstrap("org-b", "bob", 3);
    await model.admit("org-a", "bob", "invitation");
    await model.admit("org-b", "alice", "invitation");
    await model.nominate({ id: "a", organizationId: "org-a", from: "alice", to: "bob", expiresAt: 100 });
    await model.nominate({ id: "b", organizationId: "org-b", from: "bob", to: "alice", expiresAt: 100 });
    await Promise.all([model.accept("a", "bob", 1), model.accept("b", "alice", 1)]);
    expect(model.member("org-a", "bob").role).toBe("owner");
    expect(model.member("org-b", "alice").role).toBe("owner");
    for (const trace of model.locks.traces) expect(trace).toEqual([...trace].sort());
  });
});

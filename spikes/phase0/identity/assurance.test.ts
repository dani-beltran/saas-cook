import { describe, expect, it } from "vitest";
import { DirectorySubjectMap, requireAssurance, requireCredentialRemoval, safeDestination, type AuthenticationEvidence, type TenantPolicy } from "./assurance";

const now = 1_000_000;
const policy: TenantPolicy = { requireMfa: true, acceptVerifiedPasskey: true, maxAuthenticationAgeMs: 300_000 };
const evidence: AuthenticationEvidence = { method: "passkey", userVerified: true, secondFactorVerified: false, authenticatedAt: now };

describe("proposed application assurance contract (not WebAuthn verification)", () => {
  it("permits a fresh verified passkey for passwordless sensitive actions", () => {
    expect(() => requireAssurance(evidence, policy, now, "active")).not.toThrow();
  });
  it.each(["email", "passkey"] as const)("does not infer MFA from %s without verified assurance", (method) => {
    expect(() => requireAssurance({ ...evidence, method, userVerified: false }, policy, now, "active")).toThrow("mfa_required");
  });
  it("requires an explicit policy permitting verified passkeys as MFA", () => {
    expect(() => requireAssurance(evidence, { ...policy, acceptVerifiedPasskey: false }, now, "active")).toThrow("mfa_required");
  });
  it("rechecks target tenant SSO even for a valid MFA session", () => {
    const sso = { ...evidence, method: "sso" as const, secondFactorVerified: true, connectionId: "tenant-a" };
    expect(() => requireAssurance(sso, { ...policy, requiredSsoConnection: "tenant-b" }, now, "active")).toThrow("tenant_sso_required");
  });
  it.each(["frozen", "deleted"] as const)("denies login/recovery/linking for %s identities", (status) => {
    expect(() => requireAssurance(evidence, policy, now, status)).toThrow("account_unavailable");
  });
  it.each([now + 1, now - 300_001, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY])("rejects invalid, future or stale authentication evidence: %s", (authenticatedAt) => {
    expect(() => requireAssurance({ ...evidence, authenticatedAt }, policy, now, "active")).toThrow("fresh_authentication_required");
  });
  it("protects final credentials unless a separate verified recovery path exists", () => {
    expect(() => requireCredentialRemoval(0, false)).toThrow("recovery_required");
    expect(() => requireCredentialRemoval(1, false)).not.toThrow();
    expect(() => requireCredentialRemoval(0, true)).not.toThrow();
  });
  it.each(["https://evil.example", "//evil.example", "/\\evil.example", "/\n/evil.example"])("denies unsafe destination %j", (url) => {
    expect(() => safeDestination(url, "https://auth.example.test")).toThrow("unsafe_redirect");
  });
  it("keeps same-origin path destinations", () => {
    expect(safeDestination("/app/acme?tab=members", "https://auth.example.test")).toBe("/app/acme?tab=members");
  });
  it("scopes directory identity to its connection, with no email linking", () => {
    const subjects = new DirectorySubjectMap();
    subjects.link("connection-a", "subject-1", "org-a", "user-a");
    subjects.link("connection-b", "subject-1", "org-b", "user-b");
    expect(subjects.resolve("connection-a", "subject-1")).toEqual({ organizationId: "org-a", userId: "user-a" });
    expect(subjects.resolve("connection-b", "subject-1")).toEqual({ organizationId: "org-b", userId: "user-b" });
    expect(() => subjects.resolve("connection-c", "subject-1")).toThrow("unknown_subject");
    expect(() => subjects.link("connection-a", "subject-1", "org-b", "user-b")).toThrow("subject_already_linked");
  });
});

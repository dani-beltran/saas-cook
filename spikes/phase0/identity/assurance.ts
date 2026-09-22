/** Phase 0 policy model. Callers must obtain evidence from the verified provider
 * result and authoritative lifecycle rows; request body/cookie claims are invalid. */
export type AuthenticationEvidence = {
  method: "email" | "passkey" | "sso";
  authenticatedAt: number;
  userVerified: boolean;
  secondFactorVerified: boolean;
  connectionId?: string;
};

export type TenantPolicy = {
  requireMfa: boolean;
  acceptVerifiedPasskey: boolean;
  requiredSsoConnection?: string;
  maxAuthenticationAgeMs: number;
};

export function requireAssurance(
  evidence: AuthenticationEvidence,
  policy: TenantPolicy,
  now: number,
  accountStatus: "active" | "frozen" | "deleted",
): void {
  if (accountStatus !== "active") throw new Error("account_unavailable");
  const age = now - evidence.authenticatedAt;
  if (
    !Number.isFinite(now) ||
    !Number.isFinite(evidence.authenticatedAt) ||
    !Number.isFinite(policy.maxAuthenticationAgeMs) ||
    policy.maxAuthenticationAgeMs < 0 ||
    age < 0 ||
    age > policy.maxAuthenticationAgeMs
  )
    throw new Error("fresh_authentication_required");
  if (
    policy.requiredSsoConnection &&
    (evidence.method !== "sso" ||
      evidence.connectionId !== policy.requiredSsoConnection)
  )
    throw new Error("tenant_sso_required");
  const satisfiesMfa =
    evidence.secondFactorVerified ||
    (policy.acceptVerifiedPasskey &&
      evidence.method === "passkey" &&
      evidence.userVerified);
  if (policy.requireMfa && !satisfiesMfa) throw new Error("mfa_required");
}

export function requireCredentialRemoval(
  usableCredentialsAfterRemoval: number,
  independentlyVerifiedRecoveryAvailable: boolean,
): void {
  if (usableCredentialsAfterRemoval < 1 && !independentlyVerifiedRecoveryAvailable)
    throw new Error("recovery_required");
}

/** Restrict redirects before invoking the provider, including its error redirect. */
export function safeDestination(destination: string, canonicalOrigin: string): string {
  if (!destination.startsWith("/") || destination.startsWith("//") || /[\\\r\n]/.test(destination))
    throw new Error("unsafe_redirect");
  const url = new URL(destination, canonicalOrigin);
  if (url.origin !== canonicalOrigin) throw new Error("unsafe_redirect");
  return `${url.pathname}${url.search}${url.hash}`;
}

/** Connection IDs are server-resolved. Email is deliberately not a lookup key. */
export class DirectorySubjectMap {
  private readonly subjects = new Map<string, { organizationId: string; userId: string }>();

  link(connectionId: string, externalSubject: string, organizationId: string, userId: string): void {
    const key = JSON.stringify([connectionId, externalSubject]);
    if (this.subjects.has(key)) throw new Error("subject_already_linked");
    this.subjects.set(key, { organizationId, userId });
  }

  resolve(connectionId: string, externalSubject: string) {
    const subject = this.subjects.get(JSON.stringify([connectionId, externalSubject]));
    if (!subject) throw new Error("unknown_subject");
    return { ...subject };
  }
}

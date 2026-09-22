/** Executable domain decision model, not production persistence or authorization.
 * Exclusive mutexes stand in for PostgreSQL user fences and organization locks.
 * All validation precedes a synchronous commit; no remote calls hold these locks. */
export type User = { id: string; status: "active" | "frozen"; verified: boolean };
export type Member = { organizationId: string; userId: string; role: "owner" | "member"; active: boolean };
export type Organization = { id: string; capacity: number; occupied: number; revision: number; ownerVersion: number; status: "active" | "owner_recovery_required" };
export type Transfer = { id: string; organizationId: string; from: string; to: string; ownerVersion: number; expiresAt: number; status: "pending" | "accepted" | "canceled" };
export type Receipt = { action: string; organizationId: string; userId: string; revision: number };

class OrderedLocks {
  private readonly tails = new Map<string, Promise<void>>();
  readonly traces: string[][] = [];

  async run<T>(keys: string[], action: () => Promise<T> | T): Promise<T> {
    const releases: Array<() => void> = [];
    this.traces.push(keys);
    try {
      for (const key of keys) {
        const previous = this.tails.get(key) ?? Promise.resolve();
        let release = () => {};
        const next = new Promise<void>((resolve) => { release = resolve; });
        this.tails.set(key, previous.then(() => next));
        await previous;
        releases.push(release);
      }
      return await action();
    } finally {
      for (const release of releases.reverse()) release();
    }
  }
}

export class LifecycleModel {
  readonly users = new Map<string, User>();
  readonly organizations = new Map<string, Organization>();
  readonly members = new Map<string, Member>();
  readonly transfers = new Map<string, Transfer>();
  readonly audit: Receipt[] = [];
  readonly outbox: Receipt[] = [];
  readonly locks = new OrderedLocks();
  fgaAvailable = true;

  member(organizationId: string, userId: string): Member {
    const member = this.members.get(JSON.stringify([organizationId, userId]));
    if (!member) throw new Error("membership_missing");
    return member;
  }

  private activeUser(id: string): User {
    const user = this.users.get(id);
    if (!user || user.status !== "active") throw new Error("account_unavailable");
    return user;
  }

  private organization(id: string): Organization {
    const organization = this.organizations.get(id);
    if (!organization) throw new Error("organization_missing");
    return organization;
  }

  private userKeys(ids: string[]) { return [...new Set(ids)].sort().map((id) => `0:user:${id}`); }
  private orgKeys(ids: string[]) {
    return [...new Set(ids)].sort().flatMap((id) => [
      `1:org:${id}:0:authorization`, `1:org:${id}:1:lifecycle`,
      `1:org:${id}:2:capacity`, `1:org:${id}:3:memberships`,
    ]);
  }

  private transact<T>(users: string[], organizations: string[], action: () => T) {
    return this.locks.run([...this.userKeys(users), ...this.orgKeys(organizations)], action);
  }

  private activeOwners(organizationId: string) {
    return [...this.members.values()].filter((member) => member.organizationId === organizationId && member.active && member.role === "owner" && this.users.get(member.userId)?.status === "active");
  }

  private changed(organization: Organization, userId: string, action: string) {
    organization.revision += 1;
    const receipt = { action, organizationId: organization.id, userId, revision: organization.revision };
    this.audit.push(receipt);
    this.outbox.push({ ...receipt });
  }

  async bootstrap(organizationId: string, userId: string, capacity: number) {
    return this.transact([userId], [organizationId], () => {
      this.activeUser(userId);
      if (this.organizations.has(organizationId)) throw new Error("organization_exists");
      if (capacity < 1) throw new Error("capacity_exceeded");
      const organization: Organization = { id: organizationId, capacity, occupied: 1, revision: 0, ownerVersion: 1, status: "active" };
      this.organizations.set(organizationId, organization);
      this.members.set(JSON.stringify([organizationId, userId]), { organizationId, userId, active: true, role: "owner" });
      this.changed(organization, userId, "bootstrap");
    });
  }

  async admit(organizationId: string, userId: string, source: "invitation" | "scim" | "reactivation") {
    return this.transact([userId], [organizationId], () => {
      this.activeUser(userId);
      const organization = this.organization(organizationId);
      if (!this.fgaAvailable || organization.status !== "active") throw new Error("authorization_unavailable");
      const key = JSON.stringify([organizationId, userId]);
      if (this.members.get(key)?.active) return;
      if (organization.occupied + 1 > organization.capacity) throw new Error("capacity_exceeded");
      this.members.set(key, { organizationId, userId, active: true, role: "member" });
      organization.occupied += 1;
      this.changed(organization, userId, source);
    });
  }

  async demote(organizationId: string, userId: string) {
    return this.transact([userId], [organizationId], () => {
      this.activeUser(userId);
      const organization = this.organization(organizationId);
      const member = this.member(organizationId, userId);
      if (!member.active || member.role !== "owner") throw new Error("active_owner_required");
      if (this.activeOwners(organizationId).length <= 1) throw new Error("last_owner");
      member.role = "member";
      organization.ownerVersion += 1;
      this.changed(organization, userId, "demote");
    });
  }

  /** The fixture represents an already authenticated, bounded control-plane command. */
  async securityDeactivate(organizationId: string, userId: string) {
    return this.transact([userId], [organizationId], () => {
      const organization = this.organization(organizationId);
      const member = this.member(organizationId, userId);
      if (!member.active) return;
      member.active = false;
      organization.occupied -= 1;
      organization.ownerVersion += 1;
      if (this.activeOwners(organizationId).length === 0) organization.status = "owner_recovery_required";
      this.changed(organization, userId, "security_deactivate");
    });
  }

  async nominate(transfer: Omit<Transfer, "status" | "ownerVersion">) {
    return this.transact([transfer.from, transfer.to], [transfer.organizationId], () => {
      this.activeUser(transfer.from);
      const recipient = this.activeUser(transfer.to);
      const organization = this.organization(transfer.organizationId);
      const from = this.member(transfer.organizationId, transfer.from);
      const to = this.member(transfer.organizationId, transfer.to);
      if (transfer.from === transfer.to || !recipient.verified || !to.active || !from.active || from.role !== "owner") throw new Error("invalid_transfer_parties");
      if ([...this.transfers.values()].some((item) => item.organizationId === transfer.organizationId && item.from === transfer.from && item.status === "pending")) throw new Error("transfer_pending");
      if (this.transfers.has(transfer.id)) throw new Error("transfer_exists");
      this.transfers.set(transfer.id, { ...transfer, status: "pending", ownerVersion: organization.ownerVersion });
    });
  }

  async accept(transferId: string, actorId: string, now: number) {
    const transfer = this.transfers.get(transferId);
    if (!transfer) throw new Error("transfer_missing");
    return this.transact([transfer.from, transfer.to], [transfer.organizationId], () => {
      if (actorId !== transfer.to) throw new Error("recipient_required");
      this.activeUser(transfer.from);
      const recipient = this.activeUser(transfer.to);
      const organization = this.organization(transfer.organizationId);
      if (transfer.status === "accepted") return;
      if (transfer.status !== "pending" || transfer.expiresAt <= now) throw new Error("transfer_unavailable");
      if (organization.ownerVersion !== transfer.ownerVersion) throw new Error("ownership_conflict");
      const from = this.member(transfer.organizationId, transfer.from);
      const to = this.member(transfer.organizationId, transfer.to);
      if (!recipient.verified || !from.active || from.role !== "owner" || !to.active) throw new Error("invalid_transfer_parties");
      if (!this.fgaAvailable || organization.status !== "active") throw new Error("authorization_unavailable");
      // Both memberships are already billable, so this transition's seat delta is zero.
      from.role = "member";
      to.role = "owner";
      organization.ownerVersion += 1;
      transfer.status = "accepted";
      this.changed(organization, transfer.to, "transfer_accepted");
    });
  }

  async freeze(userId: string) {
    // The user fence protects enumeration against admission and transfer acceptance.
    return this.locks.run(this.userKeys([userId]), async () => {
      const user = this.users.get(userId);
      if (!user) throw new Error("account_missing");
      if (user.status === "frozen") return;
      const orgIds = [...this.members.values()].filter((member) => member.userId === userId && member.active).map((member) => member.organizationId);
      return this.locks.run(this.orgKeys(orgIds), () => {
        for (const orgId of orgIds) {
          if (this.member(orgId, userId).role === "owner" && this.activeOwners(orgId).length < 2) throw new Error("unresolved_ownership");
        }
        user.status = "frozen";
        for (const transfer of this.transfers.values()) {
          if ((transfer.from === userId || transfer.to === userId) && transfer.status === "pending") transfer.status = "canceled";
        }
        // Durable journal acknowledgement and provider cleanup belong to Phase 6.
      });
    });
  }

  async recoverOwner(organizationId: string, userId: string, evidence: { independentAuthority: boolean; freshMfa: boolean; evidenceId: string }, publish: (revision: number) => Promise<boolean>) {
    const revision = await this.transact([userId], [organizationId], () => {
      this.activeUser(userId);
      const organization = this.organization(organizationId);
      if (!evidence.independentAuthority || !evidence.freshMfa || !evidence.evidenceId) throw new Error("recovery_evidence_required");
      if (organization.status !== "owner_recovery_required") throw new Error("recovery_not_required");
      const existing = this.members.get(JSON.stringify([organizationId, userId]));
      const delta = existing?.active ? 0 : 1;
      if (organization.occupied + delta > organization.capacity) throw new Error("capacity_exceeded");
      this.members.set(JSON.stringify([organizationId, userId]), { organizationId, userId, active: true, role: "owner" });
      organization.occupied += delta;
      organization.ownerVersion += 1;
      this.changed(organization, userId, "recovery_admitted");
      return organization.revision;
    });
    if (!(await publish(revision))) return;
    await this.transact([userId], [organizationId], () => {
      const organization = this.organization(organizationId);
      if (organization.revision !== revision || !this.member(organizationId, userId).active || this.users.get(userId)?.status !== "active") throw new Error("stale_recovery_publication");
      organization.status = "active";
    });
  }

  canUseTenant(organizationId: string, userId: string) {
    return this.users.get(userId)?.status === "active" && this.member(organizationId, userId).active && this.organization(organizationId).status === "active";
  }
}

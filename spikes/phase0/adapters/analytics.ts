/** Application-contract experiment. These Maps model durable records; they are not production storage. */
export type AnalyticsEvent = Readonly<{
  id: string;
  subject: string; // server-created opaque (user, organization) scope
  organization: string;
  name: 'core_action';
  properties: { feature: 'project' | 'task' };
  expiresAt: number;
}>;
export interface AnalyticsProvider {
  capture(event: AnalyticsEvent, signal: AbortSignal): Promise<void>;
  deleteSubject(subject: string): Promise<'confirmed' | 'pending'>;
}
export class AnalyticsSpool {
  readonly suppressed = new Set<string>();
  readonly ambiguous = new Set<string>();
  readonly queue = new Map<string, AnalyticsEvent>();
  readonly seen = new Set<string>();
  private inflight = new Map<string, { subject: string; settled: Promise<void> }>();
  dropped = 0;

  constructor(
    private readonly provider: AnalyticsProvider | undefined,
    private readonly permits: (event: AnalyticsEvent) => boolean,
    private readonly now: () => number,
    private readonly limit = 10_000,
    private readonly timeoutMs = 5_000,
  ) {}

  enqueue(event: AnalyticsEvent): boolean {
    if (!this.provider || this.suppressed.has(event.subject) || !this.permits(event)) return false;
    if (this.seen.has(event.id)) return false;
    // The actual producer owns this allowlist; arbitrary event bags are never forwarded.
    if (event.name !== 'core_action' || !['project', 'task'].includes(event.properties.feature) ||
        Object.keys(event.properties).some((key) => key !== 'feature')) throw new Error('Undeclared analytics property');
    if (this.queue.size >= this.limit || event.expiresAt <= this.now()) { this.dropped++; return false; }
    this.seen.add(event.id);
    this.queue.set(event.id, structuredClone(event));
    return true;
  }

  async dispatch(id: string): Promise<void> {
    const event = this.queue.get(id);
    if (!event || !this.provider) return;
    this.queue.delete(id);
    if (this.suppressed.has(event.subject) || !this.permits(event) || event.expiresAt <= this.now()) {
      this.dropped++;
      return;
    }
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    // Defer transport invocation one microtask so the lease is visible before any callback runs.
    const settled = Promise.race([
      Promise.resolve().then(() => this.provider!.capture(event, controller.signal)),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => { controller.abort(); reject(new Error('delivery timeout')); }, this.timeoutMs);
      }),
    ]).catch(() => {
      // Cancellation/timeout does not prove that a remote capture did not happen.
      this.ambiguous.add(event.subject);
    }).finally(() => {
      clearTimeout(timer);
      this.inflight.delete(id);
    });
    this.inflight.set(id, { subject: event.subject, settled });
    await settled;
  }

  async suppressAndDelete(subject: string): Promise<'completed' | 'provider-pending'> {
    this.suppressed.add(subject);
    for (const [id, event] of this.queue) if (event.subject === subject) this.queue.delete(id);
    await Promise.all([...this.inflight.values()].filter((i) => i.subject === subject).map((i) => i.settled));
    if (!this.provider) return 'completed';
    let result: 'confirmed' | 'pending';
    try { result = await this.provider.deleteSubject(subject); } catch { result = 'pending'; }
    // No elapsed quiet period can clear an ambiguous provider write. A real adapter needs proof.
    return result === 'confirmed' && !this.ambiguous.has(subject) ? 'completed' : 'provider-pending';
  }
}

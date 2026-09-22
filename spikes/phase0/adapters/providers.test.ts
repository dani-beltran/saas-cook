import Stripe from 'stripe';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AnalyticsSpool, type AnalyticsEvent, type AnalyticsProvider } from './analytics';

const event = (id = 'event-1', subject = 'opaque-user-org-a'): AnalyticsEvent => ({
  id, subject, organization: subject.endsWith('-b') ? 'opaque-org-b' : 'opaque-org-a',
  name: 'core_action', properties: { feature: 'project' }, expiresAt: 100,
});
const provider = (): AnalyticsProvider => ({ capture: vi.fn(async () => {}), deleteSubject: vi.fn(async () => 'confirmed' as const) });

afterEach(() => vi.useRealTimers());

describe('billing adapter feasibility (actual Stripe SDK, local signature fixture)', () => {
  const stripe = new Stripe('sk_test_phase0_fixture_not_a_real_credential');
  const secret = 'whsec_phase0_fixture_not_a_real_credential';
  const payload = JSON.stringify({ id: 'evt_fixture', object: 'event', type: 'invoice.paid', data: { object: { id: 'in_fixture' } } });
  it('verifies the exact raw signed payload and refuses mutations, wrong secret and old timestamps', () => {
    const header = stripe.webhooks.generateTestHeaderString({ payload, secret });
    expect(stripe.webhooks.constructEvent(payload, header, secret).id).toBe('evt_fixture');
    expect(() => stripe.webhooks.constructEvent(`${payload} `, header, secret)).toThrow();
    expect(() => stripe.webhooks.constructEvent(payload, header, 'whsec_wrong')).toThrow();
    const expired = stripe.webhooks.generateTestHeaderString({ payload, secret, timestamp: Math.floor(Date.now() / 1000) - 600 });
    expect(() => stripe.webhooks.constructEvent(payload, expired, secret)).toThrow();
  });
});

describe('analytics application contract (injected provider; no remote deletion claim)', () => {
  it('operates without provider configuration and deduplicates/caps an enabled queue', () => {
    expect(new AnalyticsSpool(undefined, () => true, () => 0).enqueue(event())).toBe(false);
    const spool = new AnalyticsSpool(provider(), () => true, () => 0, 1);
    expect(spool.enqueue(event())).toBe(true);
    expect(spool.enqueue(event())).toBe(false);
    expect(spool.enqueue(event('overflow'))).toBe(false);
    expect(spool.dropped).toBe(1);
  });

  it('rejects undeclared payload properties and rechecks changed preferences before dispatch', async () => {
    const sink = provider();
    let allowed = true;
    const spool = new AnalyticsSpool(sink, () => allowed, () => 0);
    expect(() => spool.enqueue({ ...event(), properties: { feature: 'project', email: 'do-not-send' } } as AnalyticsEvent)).toThrow('Undeclared');
    spool.enqueue(event());
    allowed = false;
    await spool.dispatch('event-1');
    expect(sink.capture).not.toHaveBeenCalled();
  });

  it('suppresses only the deleted tenant scope and drains successful inflight capture before deletion', async () => {
    let finish!: () => void;
    const order: string[] = [];
    const sink: AnalyticsProvider = {
      capture: async () => { await new Promise<void>((resolve) => { finish = resolve; }); order.push('capture'); },
      deleteSubject: async () => { order.push('delete'); return 'confirmed'; },
    };
    const spool = new AnalyticsSpool(sink, () => true, () => 0);
    spool.enqueue(event());
    spool.enqueue(event('org-b-event', 'opaque-user-org-b'));
    const delivery = spool.dispatch('event-1');
    await Promise.resolve();
    const deletion = spool.suppressAndDelete('opaque-user-org-a');
    expect(spool.enqueue(event('late-retry'))).toBe(false);
    expect(spool.queue.has('org-b-event')).toBe(true);
    finish();
    await delivery;
    expect(await deletion).toBe('completed');
    expect(order).toEqual(['capture', 'delete']);
  });

  it('bounds provider outages without throwing into product work and retains ambiguous deletion', async () => {
    vi.useFakeTimers();
    let remoteAccept!: () => void;
    const sink: AnalyticsProvider = {
      capture: async () => new Promise<void>((resolve) => { remoteAccept = resolve; }),
      deleteSubject: vi.fn(async () => 'confirmed' as const),
    };
    const spool = new AnalyticsSpool(sink, () => true, () => 0, 10, 20);
    spool.enqueue(event());
    const dispatch = spool.dispatch('event-1');
    await vi.advanceTimersByTimeAsync(21);
    await expect(dispatch).resolves.toBeUndefined();
    expect(await spool.suppressAndDelete('opaque-user-org-a')).toBe('provider-pending');
    remoteAccept(); // The event can arrive even after cancellation and confirmed delete response.
    await Promise.resolve();
    expect(await spool.suppressAndDelete('opaque-user-org-a')).toBe('provider-pending');
    expect(sink.deleteSubject).toHaveBeenCalledTimes(2);
  });

  it('drops expired work before the provider can see it', async () => {
    const sink = provider();
    let now = 0;
    const spool = new AnalyticsSpool(sink, () => true, () => now);
    spool.enqueue(event());
    now = 101;
    await spool.dispatch('event-1');
    expect(sink.capture).not.toHaveBeenCalled();
    expect(spool.dropped).toBe(1);
  });
});

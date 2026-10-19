import { expect, it } from "vitest";
import { renderBillingEmail } from "./billing";

it("renders mandatory billing and threshold notices in both locales with HTML/text parity", async () => {
	for (const locale of ["en", "es"] as const) {
		const result = await renderBillingEmail({
			to: "synthetic@example.test",
			locale,
			kind: "threshold",
			url: "https://example.test/en/usage?a=1&b=2",
			threshold: 95,
			periodEnd: "2026-10-01T00:00:00Z",
		});
		expect(result.html).toContain(`lang="${locale}"`);
		expect(result.html).toContain("95%");
		expect(result.text).toContain("95%");
		expect(result.html).toContain("a=1&amp;b=2");
		expect(result.text).toContain("https://example.test/");
	}
	const billing = await renderBillingEmail({
		to: "synthetic@example.test",
		locale: "en",
		kind: "billing",
		url: "https://example.test/billing",
		overCapacity: true,
		accessState: "grace",
		effectiveAt: "2026-10-01T00:00:00Z",
	});
	expect(billing.text).toContain("existing memberships are preserved");
	expect(billing.text).toContain("A payment is overdue");
	expect(billing.text).toContain("Next billing lifecycle date");
});

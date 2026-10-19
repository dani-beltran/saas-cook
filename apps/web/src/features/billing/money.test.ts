import { expect, it } from "vitest";
import { formatBillingAmount } from "./money";

it("displays Stripe charge minor units across two-decimal, zero-decimal and compatibility currencies", () => {
	expect(formatBillingAmount(1234, "eur", "en-US")).toBe("€12.34");
	expect(formatBillingAmount(1234, "jpy", "en-US")).toBe("¥1,234");
	expect(formatBillingAmount(1200, "isk", "en-US")).toBe("ISK\u00a012");
	expect(formatBillingAmount(1200, "ugx", "en-US")).toBe("UGX\u00a012");
});

import { expect, test } from "@playwright/test";
import { auditAccessibility } from "../accessibility";

// Actual production components, including failure and pending states that are hard
// to hold steady in a full service journey. Backoffice reuses these UI primitives.
const stories = [
	"foundation-controls--default",
	"foundation-controls--disabled",
	"foundation-localized-form--invalid",
	"projects-localized-form--create",
	"projects-localized-form--invalid",
	"projects-localized-form--saving",
	"projects-localized-form--pending-edit",
	"dashboard-navigation--organization-context",
	"dashboard-navigation--loading",
	"dashboard-navigation--retry-unavailable",
	"dashboard-organization-interactions--member-actions",
	"dashboard-organization-interactions--team-membership",
	"account-appearance--system",
	"account-appearance--loading",
	"example-business-features-customers--directory",
	"example-business-features-customers--create-validation",
	"example-business-features-customers--pending",
	"example-business-features-customers--recoverable-failure",
	"commercial-billing-and-usage--foundation",
	"commercial-billing-and-usage--pending",
	"commercial-billing-and-usage--over-capacity-and-outage",
	"commercial-billing-and-usage--quota-reached",
	"platform-activity--loading",
	"platform-activity--empty",
	"platform-activity--denied",
	"platform-activity--recent",
	"backoffice-workspace--empty",
	"backoffice-workspace--pending",
	"backoffice-workspace--denied",
	"backoffice-workspace--organization",
];
const contexts = [
	{ locale: "en", mode: "light", width: 1440 },
	{ locale: "en", mode: "dark", width: 390 },
	{ locale: "es", mode: "dark", width: 1440 },
	{ locale: "es", mode: "light", width: 390 },
];
for (const { locale, mode, width } of contexts) {
	for (const story of stories) {
		test(`${story}: ${locale} ${mode} ${width}px accessibility`, async ({
			page,
		}, info) => {
			// The dev server responds before Vite finishes compiling a cold story chunk.
			// Bound initial rendering separately while leaving time for the actual axe audit.
			test.setTimeout(60_000);
			await page.setViewportSize({ width, height: 900 });
			await page.goto(
				`/iframe.html?id=${story}&globals=locale:${locale};mode:${mode}`,
			);
			await expect(page.locator("#storybook-root")).not.toBeEmpty({
				timeout: 30_000,
			});
			await expect(page.locator("html")).toHaveAttribute("lang", locale);
			await auditAccessibility(page, info, story);
		});
	}
}

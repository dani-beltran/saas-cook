import AxeBuilder from "@axe-core/playwright";
import { expect, type Page, type TestInfo } from "@playwright/test";

/**
 * Audits the rendered page against axe's WCAG A/AA rules, including WCAG 2.2.
 * @param page - A page whose relevant UI state is already visible.
 * @param info - Playwright test context used to retain the complete axe report.
 * @param state - Stable, descriptive label for the report attachment.
 * @returns Resolves when no violations are found; assertion failures retain affected nodes.
 * This complements keyboard and assistive-technology review; it cannot prove full conformance.
 */
export async function auditAccessibility(
	page: Page,
	info: TestInfo,
	state: string,
) {
	const result = await new AxeBuilder({ page })
		.withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
		.analyze();
	await info.attach(`${state}-axe.json`, {
		body: JSON.stringify(result, null, 2),
		contentType: "application/json",
	});
	expect(result.violations, `${state}: accessibility violations`).toEqual([]);
}

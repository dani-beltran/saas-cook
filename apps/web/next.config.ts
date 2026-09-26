import { resolve } from "node:path";
import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

const withNextIntl = createNextIntlPlugin("./src/i18n/request.ts");

export default withNextIntl({
	poweredByHeader: false,
	output: "standalone",
	outputFileTracingRoot: resolve(import.meta.dirname, "../.."),
	transpilePackages: [
		"@common-saas/api",
		"@common-saas/config",
		"@common-saas/ui",
	],
} satisfies NextConfig);

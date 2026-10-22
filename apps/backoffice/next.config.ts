import { resolve } from "node:path";
import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";
export default createNextIntlPlugin("./src/i18n/request.ts")({
	output: "standalone",
	outputFileTracingRoot: resolve(import.meta.dirname, "../.."),
	poweredByHeader: false,
	transpilePackages: [
		"@saas-cook/backoffice",
		"@saas-cook/backoffice-contracts",
		"@saas-cook/auth",
		"@saas-cook/authz",
		"@saas-cook/config",
	],
	async headers() {
		return [
			{
				source: "/:path*",
				headers: [
					{ key: "Cache-Control", value: "no-store" },
					{ key: "Referrer-Policy", value: "no-referrer" },
					{ key: "X-Content-Type-Options", value: "nosniff" },
					{ key: "X-Frame-Options", value: "DENY" },
				],
			},
		];
	},
} satisfies NextConfig);

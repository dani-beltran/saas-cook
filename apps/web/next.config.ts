import { resolve } from "node:path";
import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

const withNextIntl = createNextIntlPlugin("./src/i18n/request.ts");

export default withNextIntl({
	poweredByHeader: false,
	// Preserve the absolute loopback-origin redirect; Next otherwise treats
	// localhost and 127.0.0.1 as the same host and emits a looping relative URL.
	skipProxyUrlNormalize: true,
	async headers() {
		return [
			{
				source: "/:path*",
				headers: [
					{ key: "Referrer-Policy", value: "no-referrer" },
					{ key: "X-Content-Type-Options", value: "nosniff" },
				],
			},
		];
	},
	output: "standalone",
	// Keep native bindings outside webpack and trace them into the standalone image.
	serverExternalPackages: ["sharp"],
	outputFileTracingRoot: resolve(import.meta.dirname, "../.."),
	transpilePackages: [
		"@common-saas/api",
		"@common-saas/config",
		"@common-saas/ui",
	],
} satisfies NextConfig);

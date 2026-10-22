import type { KnipConfig } from "knip";

const config: KnipConfig = {
	// AttemptState is part of the retained historical protocol evidence.
	ignoreIssues: { "spikes/phase0/authz/protocol.ts": ["types"] },
	workspaces: {
		".": {
			// System OpenSSL generates disposable one-day TLS certificates for the BO browser fixture.
			ignoreBinaries: ["openssl"],
			entry: [
				"scripts/phase0/{api-smoke,toolchain}.ts",
				"scripts/phase1/{authz-validate,build-runtime,command,dev,image-test,security-scan}.ts",
				"scripts/phase1/**/*.test.ts",
				"scripts/phase4/**/*.test.ts",
				// Explicit operator entry for resuming historical synthetic erasure evidence.
				"scripts/phase6/posthog-erasure.ts",
				"spikes/phase0/**/*.test.{ts,tsx}",
				"infra/docker/{entrypoint.mjs,healthcheck.cjs,supervisor.ts,backoffice-start.ts}",
			],
			project: [
				// Shared axe helper imported by both Playwright configurations.
				"tests/accessibility.ts",
				"scripts/**/*.ts",
				"spikes/phase0/**/*.{ts,tsx,css}",
				"infra/docker/*.{ts,cjs,mjs}",
				"*.config.ts",
			],
			playwright: {
				config: [
					"playwright.config.ts",
					"playwright.theme.config.ts",
					"playwright.backoffice.config.ts",
				],
			},
			vitest: { config: ["vitest.config.ts", "vitest.phase0.config.ts"] },
			// Retained Phase 0 install/version evidence is read dynamically by
			// scripts/phase0/toolchain.ts. These are exact root-only exceptions;
			// application workspace dependencies remain fully checked.
			ignoreDependencies: [
				"react-email",
				"@t3-oss/env-nextjs",
				"@openfga/sdk",
				"posthog-node",
				"@aws-sdk/s3-request-presigner",
				"@better-auth/sso",
			],
		},
		"apps/web": {
			entry: [".storybook/*.{ts,tsx}"],
			project: ["src/**/*.{ts,tsx,css}", "*.{ts,mjs}", ".storybook/*.{ts,tsx}"],
			// The PostCSS plugin loads Tailwind's compiler; the shared stylesheet
			// that imports it lives in @saas-cook/ui. Sharp is a required direct
			// dependency for Next serverExternalPackages/standalone tracing from the
			// web root; the actual decoder import lives in @saas-cook/auth.
			ignoreDependencies: ["tailwindcss", "sharp"],
		},
		"apps/backoffice": {
			entry: ["src/**/*.stories.tsx"],
			project: ["src/**/*.{ts,tsx,css}", "*.{ts,mjs}"],
			// PostCSS loads Tailwind; the shared stylesheet owns the actual CSS import.
			ignoreDependencies: ["tailwindcss"],
		},
		"apps/worker": { project: ["src/**/*.ts"] },
		"packages/*": {
			project: ["src/**/*.{ts,tsx}"],
		},
		"packages/db": {
			entry: [
				"src/example-customers/schema.ts",
				"src/billing/schema.ts",
				"src/platform/schema.ts",
				"src/files/schema.ts",
				"src/lifecycle/schema.ts",
				"src/analytics/schema.ts",
				"src/bulk/schema.ts",
				"src/settings/schema.ts",
			],
			project: ["src/**/*.ts"],
		},
		"packages/ui": {
			entry: ["src/**/*.stories.tsx"],
			project: ["src/**/*.{ts,tsx}"],
		},
		"spikes/phase0/api-next": {
			entry: ["*.stories.tsx"],
			project: ["**/*.{ts,tsx,css}", "!**/.next/**"],
		},
		"spikes/phase0/contracts": { project: ["*.ts"] },
	},
};

export default config;

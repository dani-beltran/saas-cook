export async function register() {
	if (
		process.env.NEXT_RUNTIME === "nodejs" &&
		process.env.NEXT_PHASE !== "phase-production-build"
	) {
		const { readWebEnv } = await import("@common-saas/config/server");
		readWebEnv();
		const { initializeObservability } = await import(
			"@common-saas/observability"
		);
		initializeObservability("web");
	}
}

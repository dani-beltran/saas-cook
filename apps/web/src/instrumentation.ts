export async function register() {
	if (
		process.env.NEXT_RUNTIME === "nodejs" &&
		process.env.NEXT_PHASE !== "phase-production-build"
	) {
		const { readWebEnv } = await import("@saas-cook/config/server");
		readWebEnv();
		const { initializeObservability } = await import(
			"@saas-cook/observability"
		);
		initializeObservability("web");
	}
}

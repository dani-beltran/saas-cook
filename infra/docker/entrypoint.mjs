const mode = process.argv[2] ?? "serve";
try {
	if (mode === "serve") await import("/app/dist/supervisor.mjs");
	else if (
		[
			"migrate",
			"bootstrap",
			"authz-publish",
			"authz-upgrade",
			"owner-recovery",
			"security-deactivate",
		].includes(mode)
	)
		await import("/app/dist/command.mjs");
	else if (
		[
			"billing-catalogue",
			"billing-reconcile",
			"billing-diagnostics",
			"usage-rebuild",
		].includes(mode)
	) {
		process.argv[2] = mode.replace(/^(billing|usage)-/, "");
		await import("/app/dist/billing-command.mjs");
	} else if (
		[
			"control-schema",
			"recovery",
			"recovery-fingerprint",
			"analytics-report",
			"flags-set",
		].includes(mode)
	) {
		await import("/app/dist/platform-command.mjs");
	} else {
		process.stderr.write(
			"Unknown mode. Use serve, migrate, bootstrap, authz-publish, authz-upgrade, owner-recovery, security-deactivate, billing-catalogue, billing-reconcile, billing-diagnostics, usage-rebuild, control-schema, recovery, recovery-fingerprint, analytics-report or flags-set.\n",
		);
		process.exitCode = 2;
	}
} catch {
	process.stderr.write(
		"Application startup failed; check runtime configuration.\n",
	);
	process.exitCode = 1;
}

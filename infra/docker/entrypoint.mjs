const mode = process.argv[2] ?? "serve";
try {
	if (mode === "serve") await import("/app/dist/supervisor.mjs");
	else if (
		[
			"migrate",
			"bootstrap",
			"authz-publish",
			"owner-recovery",
			"security-deactivate",
		].includes(mode)
	)
		await import("/app/dist/command.mjs");
	else {
		process.stderr.write(
			"Unknown mode. Use serve, migrate, bootstrap, authz-publish, owner-recovery or security-deactivate.\n",
		);
		process.exitCode = 2;
	}
} catch {
	process.stderr.write(
		"Application startup failed; check runtime configuration.\n",
	);
	process.exitCode = 1;
}

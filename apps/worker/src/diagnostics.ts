/** Classify known failures without emitting driver messages, URLs or payloads. */
export function workerFailureStatus(error: unknown): string {
	if (typeof error === "object" && error !== null && "code" in error) {
		switch (error.code) {
			case "3D000":
				return "database_missing";
			case "42P01":
			case "3F000":
				return "schema_missing";
			case "28P01":
			case "28000":
			case "42501":
			case "EACCES":
			case "EPERM":
				return "access_denied";
			case "ECONNREFUSED":
			case "ENOTFOUND":
			case "ETIMEDOUT":
				return "connection_failed";
		}
	}
	if (error instanceof Error) {
		switch (error.message) {
			case "Independent authorization readiness required":
				return "authorization_not_ready";
			case "Worker readiness required":
				return "binding_mismatch";
			case "pg-boss is not installed":
			case "pg-boss database requires migrations":
				return "queue_setup_required";
		}
	}
	return "unknown";
}

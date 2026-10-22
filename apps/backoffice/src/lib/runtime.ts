import { createBackofficeRuntime } from "@saas-cook/backoffice";

let runtime: ReturnType<typeof createBackofficeRuntime> | undefined;
/** Lazy composition keeps builds credential-free; request admission validates runtime configuration. */
export function backoffice() {
	if (!runtime) runtime = createBackofficeRuntime();
	return runtime;
}

import type {
	DiagnosticDto,
	DiagnosticInput,
} from "@common-saas/api-contracts";

export type RequestContext = { requestId: string; request?: Request };
/** Public, stateless scaffolding. Tenant features must introduce an authenticated
 * service boundary in Phase 2; request headers never establish an actor here. */
export function echoDiagnostic(
	context: RequestContext,
	input: DiagnosticInput,
): DiagnosticDto {
	return {
		message: input.message,
		locale: input.locale,
		requestId: context.requestId,
	};
}

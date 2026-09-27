import { createORPCClient } from "@orpc/client";
import { RPCLink } from "@orpc/client/fetch";
import type { ContractRouterClient } from "@orpc/contract";
import type { contract } from "@saas-cook/api-contracts";

export type ApiClient = ContractRouterClient<typeof contract>;
/** Browser entry point imports contracts only; server implementations stay out of bundles. */
export function createApiClient(
	url: string,
	fetcher: typeof fetch = globalThis.fetch.bind(globalThis),
): ApiClient {
	return createORPCClient(new RPCLink({ url, fetch: fetcher }));
}

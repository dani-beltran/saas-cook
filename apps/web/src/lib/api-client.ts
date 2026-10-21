import { createApiClient } from "@saas-cook/api/client";

/**
 * Creates a typed API client for the browser's current origin.
 * Call it from a client event handler or effect; it does not authenticate by itself.
 * @returns A client whose calls carry the current browser session.
 * @throws ReferenceError if called outside a browser because it reads window.location.
 */
export const api = () => createApiClient(`${window.location.origin}/api/rpc`);

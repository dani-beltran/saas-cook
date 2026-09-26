"use client";
import { passkeyClient } from "@better-auth/passkey/client";
import { twoFactorClient } from "better-auth/client/plugins";
import { createAuthClient } from "better-auth/react";
export const identityClient = createAuthClient({
	plugins: [passkeyClient(), twoFactorClient()],
});

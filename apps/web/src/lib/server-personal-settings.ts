import { applicationRuntime } from "@saas-cook/api/runtime";
import { headers } from "next/headers";
import { cache } from "react";
import { productTheme } from "../product-theme";

// React's request cache shares one authenticated snapshot between HTML and metadata.
export const serverPersonalSettings = cache(async () => {
	const requestHeaders = new Headers(await headers());
	if (!requestHeaders.get("cookie")) return null;
	try {
		return await applicationRuntime().identity.personalSettings.read(
			requestHeaders,
		);
	} catch {
		return null;
	} // Appearance availability never prevents the sign-in/recovery page.
});
export async function personalViewport() {
	const settings = await serverPersonalSettings();
	const mode = settings?.mode ?? productTheme.mode;
	return { colorScheme: mode === "system" ? "light dark" : mode };
}

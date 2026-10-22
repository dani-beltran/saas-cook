/**
 * Defines host-only staff cookies for the exact public origin. Better Auth adds
 * its own __Secure- prefix when useSecureCookies is true, so the explicit
 * __Host- session name uses secure attributes without automatic name prefixing.
 */
export function operatorCookies(origin: string) {
	const secure = origin.startsWith("https:");
	return {
		cookiePrefix: "backoffice",
		useSecureCookies: false,
		defaultCookieAttributes: {
			httpOnly: true,
			sameSite: "strict" as const,
			secure,
			path: "/",
		},
		cookies: {
			session_token: {
				name: secure ? "__Host-backoffice-session" : "backoffice-session",
			},
		},
	};
}

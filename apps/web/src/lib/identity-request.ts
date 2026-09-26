export class IdentityRequestError extends Error {
	constructor(readonly status: number) {
		super("identity_failed");
	}
}

export async function identityRequest(path: string, body: unknown) {
	const response = await fetch(`/api/auth/${path}`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify(body),
	});
	if (!response.ok) throw new IdentityRequestError(response.status);
	return response.json();
}

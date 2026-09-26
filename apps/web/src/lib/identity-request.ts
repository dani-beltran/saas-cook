export async function identityRequest(path: string, body: unknown) {
	const response = await fetch(`/api/auth/${path}`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify(body),
	});
	if (!response.ok) throw new Error("identity_failed");
	return response.json();
}

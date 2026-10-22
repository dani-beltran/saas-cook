/** Copies a bounded request body before passing it to the identity provider; oversized streams are canceled. */
export async function boundedOperatorRequest(request: Request, limit = 16384) {
	if (!request.body) return request;
	const reader = request.body.getReader(),
		chunks: Uint8Array[] = [];
	let size = 0;
	try {
		for (;;) {
			const { value, done } = await reader.read();
			if (done) break;
			size += value.byteLength;
			if (size > limit) throw new Error("Operator request too large");
			chunks.push(value);
		}
	} catch (error) {
		await reader.cancel();
		throw error;
	} finally {
		reader.releaseLock();
	}
	const body = Buffer.concat(chunks);
	return new Request(request.url, {
		method: request.method,
		headers: request.headers,
		body,
	});
}

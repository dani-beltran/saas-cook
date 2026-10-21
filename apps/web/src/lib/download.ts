/**
 * Starts a browser download from an API response and releases its temporary object URL.
 * @param value - Base64 file bytes, suggested filename and response content type.
 * @returns Nothing; the browser handles saving the generated Blob.
 * @throws DOMException if the supplied base64 is invalid. Callers handle API errors first.
 */
export function download(value: {
	base64: string;
	filename: string;
	contentType: string;
}) {
	const bytes = Uint8Array.from(atob(value.base64), (c) => c.charCodeAt(0)),
		url = URL.createObjectURL(new Blob([bytes], { type: value.contentType }));
	const a = document.createElement("a");
	a.href = url;
	a.download = value.filename;
	a.click();
	setTimeout(() => URL.revokeObjectURL(url), 1000);
}

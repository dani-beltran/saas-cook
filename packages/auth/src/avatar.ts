import sharp from "sharp";

export const avatarUploadLimit = 5 * 1024 * 1024;
export class PersonalSettingsError extends Error {
	constructor(
		readonly status: number,
		readonly code: string,
	) {
		super(code);
	}
}

/** Count streamed bytes, including requests without Content-Length. Never persist originals. */
export async function boundedBody(
	request: Request,
	limit: number,
): Promise<Buffer> {
	const length = request.headers.get("content-length");
	if (length && (!/^\d+$/.test(length) || Number(length) > limit))
		throw new PersonalSettingsError(413, "too_large");
	const reader = request.body?.getReader();
	if (!reader) throw new PersonalSettingsError(400, "invalid_input");
	const chunks: Uint8Array[] = [];
	let size = 0;
	let timedOut = false;
	const timeout = setTimeout(() => {
		timedOut = true;
		void reader.cancel().catch(() => {});
	}, 15000);
	let completed = false;
	try {
		while (true) {
			const { done, value } = await reader.read();
			if (done) {
				completed = true;
				break;
			}
			size += value.byteLength;
			if (size > limit) throw new PersonalSettingsError(413, "too_large");
			chunks.push(value);
		}
		if (!size || timedOut || request.signal.aborted)
			throw new PersonalSettingsError(400, "invalid_input");
		return Buffer.concat(chunks, size);
	} finally {
		clearTimeout(timeout);
		if (!completed) await reader.cancel().catch(() => {});
		reader.releaseLock();
	}
}

let decoding = 0;

export async function normalizeAvatar(input: Buffer): Promise<Buffer> {
	if (!input.length || input.length > avatarUploadLimit)
		throw new PersonalSettingsError(413, "too_large");
	// Reject non-raster formats before invoking a decoder (in particular SVG).
	const jpeg = input[0] === 0xff && input[1] === 0xd8 && input[2] === 0xff;
	const png = input
		.subarray(0, 8)
		.equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
	const webp =
		input.toString("ascii", 0, 4) === "RIFF" &&
		input.toString("ascii", 8, 12) === "WEBP";
	if (!jpeg && !png && !webp)
		throw new PersonalSettingsError(422, "invalid_image");

	// libpng can read only the first APNG frame; explicitly reject its animation control chunk.
	if (png) {
		for (let offset = 8; offset + 12 <= input.length; ) {
			const length = input.readUInt32BE(offset);
			if (input.toString("ascii", offset + 4, offset + 8) === "acTL")
				throw new PersonalSettingsError(422, "invalid_image");
			offset += length + 12;
		}
	}
	if (decoding >= 2) throw new PersonalSettingsError(429, "busy");
	decoding++;
	try {
		const decoder = sharp(input, {
			failOn: "warning",
			limitInputPixels: 16_000_000,
		});
		const metadata = await decoder.metadata();
		if (
			!metadata.width ||
			!metadata.height ||
			metadata.width > 8192 ||
			metadata.height > 8192 ||
			(metadata.pages ?? 1) > 1 ||
			!["jpeg", "png", "webp"].includes(metadata.format)
		)
			throw new Error("Invalid dimensions or format");
		const bytes = await decoder
			.autoOrient()
			.resize(512, 512, { fit: "cover", withoutEnlargement: true })
			.webp({ quality: 82, effort: 4 })
			.timeout({ seconds: 5 })
			.toBuffer();
		if (bytes.length > 524288) throw new Error("Output too large");
		return bytes;
	} catch {
		throw new PersonalSettingsError(422, "invalid_image");
	} finally {
		decoding--;
	}
}

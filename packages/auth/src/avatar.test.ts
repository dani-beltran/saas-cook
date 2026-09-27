import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { avatarUploadLimit, boundedBody, normalizeAvatar } from "./avatar";

describe("bounded avatar decoding", () => {
	for (const format of ["jpeg", "png", "webp"] as const) {
		it(`decodes ${format} contents, normalizes orientation, resizes and strips metadata`, async () => {
			const input = await sharp({
				create: { width: 800, height: 600, channels: 3, background: "teal" },
			})
				.withMetadata({ orientation: 6 })
				.toFormat(format)
				.toBuffer();
			const result = await normalizeAvatar(input);
			const metadata = await sharp(result).metadata();
			expect(metadata).toMatchObject({
				format: "webp",
				width: 512,
				height: 512,
			});
			expect(metadata.exif).toBeUndefined();
			expect(metadata.icc).toBeUndefined();
			expect(metadata.orientation).toBeUndefined();
		});
	}
	it("applies EXIF rotation to pixels and refuses PNG animation controls", async () => {
		const raw = Buffer.alloc(800 * 600 * 3);
		for (let y = 0; y < 600; y++)
			for (let x = 0; x < 800; x++)
				raw[(y * 800 + x) * 3 + (x < 400 ? 0 : 2)] = 255;
		const input = await sharp(raw, {
			raw: { width: 800, height: 600, channels: 3 },
		})
			.jpeg()
			.withMetadata({ orientation: 6 })
			.toBuffer();
		const result = await sharp(await normalizeAvatar(input))
			.raw()
			.toBuffer();
		expect(result[(100 * 512 + 256) * 3]).toBeGreaterThan(240);
		expect(result[(400 * 512 + 256) * 3 + 2]).toBeGreaterThan(240);
		const png = await sharp(raw, {
			raw: { width: 800, height: 600, channels: 3 },
		})
			.png()
			.toBuffer();
		const animation = Buffer.alloc(20);
		animation.writeUInt32BE(8);
		animation.write("acTL", 4);
		await expect(
			normalizeAvatar(
				Buffer.concat([png.subarray(0, 33), animation, png.subarray(33)]),
			),
		).rejects.toThrow("invalid_image");
	});
	it("rejects disguised SVG, malformed/truncated raster data and excess bytes", async () => {
		for (const input of [
			Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'),
			Buffer.from([255, 216, 255, 0]),
			Buffer.alloc(avatarUploadLimit + 1),
		])
			await expect(normalizeAvatar(input)).rejects.toThrow();
		const image = await sharp({
			create: { width: 100, height: 100, channels: 3, background: "red" },
		})
			.png()
			.toBuffer();
		await expect(
			normalizeAvatar(image.subarray(0, image.length - 40)),
		).rejects.toThrow("invalid_image");
	});
	it("enforces decoded dimensions and pixel limits", async () => {
		for (const [width, height] of [
			[8193, 1],
			[4001, 4000],
		]) {
			const input = await sharp({
				create: { width, height, channels: 3, background: "white" },
			})
				.png()
				.toBuffer();
			await expect(normalizeAvatar(input)).rejects.toThrow("invalid_image");
		}
	});
	it("counts streamed bodies regardless of missing/lying Content-Length", async () => {
		await expect(
			boundedBody(
				new Request("https://example.test", { method: "POST", body: "12345" }),
				4,
			),
		).rejects.toThrow("too_large");
		await expect(
			boundedBody(
				new Request("https://example.test", {
					method: "POST",
					headers: { "content-length": "1" },
					body: "12345",
				}),
				4,
			),
		).rejects.toThrow("too_large");
		expect(
			await boundedBody(
				new Request("https://example.test", { method: "POST", body: "1234" }),
				4,
			),
		).toEqual(Buffer.from("1234"));
	});
});

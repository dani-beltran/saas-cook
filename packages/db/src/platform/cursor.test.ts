import { randomUUID } from "node:crypto";
import { afterEach, expect, it, vi } from "vitest";
import { platformCursors } from "./cursor";

afterEach(() => vi.restoreAllMocks());
it("authenticates scope and position, refuses malformed encodings and enforces expiry", () => {
	const now = Date.now(),
		clock = vi.spyOn(Date, "now").mockReturnValue(now);
	const cursor = platformCursors("synthetic"),
		position = { id: randomUUID(), value: "project" };
	const token = cursor.encode("actor:org:query", position);
	expect(cursor.decode(token, "actor:org:query")).toEqual(position);
	expect(token).not.toContain(position.id);
	for (const changed of [
		"different-actor:org:query",
		"actor:other:query",
		"actor:org:other",
	])
		expect(() => cursor.decode(token, changed)).toThrow("INVALID");
	for (const bad of [
		"",
		`${token}=`,
		`${token.slice(0, 15)}!${token.slice(16)}`,
		"a".repeat(2049),
	])
		expect(() => cursor.decode(bad, "actor:org:query")).toThrow("INVALID");
	expect(() =>
		platformCursors("different-secret").decode(token, "actor:org:query"),
	).toThrow("INVALID");
	clock.mockReturnValue(now + 30 * 60_000);
	expect(() => cursor.decode(token, "actor:org:query")).toThrow("INVALID");
});

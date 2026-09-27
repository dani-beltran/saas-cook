import { afterEach, expect, it, vi } from "vitest";
import { customerCursors } from "./cursor";

afterEach(() => vi.restoreAllMocks());
it("encrypts sort values, authenticates tokens and expires old cursors", () => {
	const clock = vi.spyOn(Date, "now").mockReturnValue(1000);
	const cursors = customerCursors("synthetic-key"),
		position = {
			id: "00000000-0000-4000-8000-000000000001",
			value: "Private company",
			empty: false,
		};
	const cursor = cursors.encode("actor-tenant-full-query", position);
	expect(Buffer.from(cursor, "base64url").toString()).not.toContain(
		position.value,
	);
	expect(cursors.decode(cursor, "actor-tenant-full-query")).toEqual(position);
	expect(() => cursors.decode(cursor, "different-binding")).toThrow();
	expect(() =>
		customerCursors("other-key").decode(cursor, "actor-tenant-full-query"),
	).toThrow();
	for (const invalid of [
		"",
		"a".repeat(2049),
		`${cursor}=`,
		`${cursor.slice(0, 20)}!${cursor.slice(21)}`,
	])
		expect(() => cursors.decode(invalid, "actor-tenant-full-query")).toThrow();
	clock.mockReturnValue(1000 + 30 * 60_000);
	expect(() => cursors.decode(cursor, "actor-tenant-full-query")).toThrow();
});

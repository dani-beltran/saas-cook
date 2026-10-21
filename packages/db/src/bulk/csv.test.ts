import { expect, it } from "vitest";
import { csvDocument, mappedProjects, parseCsv } from "./csv";

it("parses bounded quoted CSV and refuses malformed/mismatched records", () => {
	expect(parseCsv('Name,Slug\r\n"a,b",slug\r\n')).toEqual([
		["Name", "Slug"],
		["a,b", "slug"],
	]);
	for (const v of ["a,a\nx,y", 'a,b\n"x,y', "a,b\nx", 'a,b\n"x"tail,y'])
		expect(() => parseCsv(v)).toThrow();
});
it("maps only declared fields and surfaces duplicate/validation row errors", () => {
	const rows = mappedProjects(
		"Title,Key\nHello,hello\nWorld,hello\nBad,UPPER",
		{ name: "Title", slug: "Key" },
	);
	expect(rows.map((r) => r.errors)).toEqual([[], ["duplicate"], ["slug"]]);
	expect(() => mappedProjects("a,b\nc,d", { name: "a", slug: "a" })).toThrow();
});
it("neutralizes formula prefixes including leading whitespace while preserving quoted content", () => {
	const csv = csvDocument(
		["name"],
		[["=SUM(1,2)"], ["  @evil"], ["plain"], ['a"b'], ["\tformula"]],
	);
	expect(csv).toContain('"\'=SUM(1,2)"');
	expect(csv).toContain('"\'  @evil"');
	expect(csv).toContain('"a""b"');
});

import { ResourceError } from "../resources";
export function parseCsv(text: string): string[][] {
	if (Buffer.byteLength(text) > 1048576 || text.includes("\0"))
		throw new ResourceError("INVALID");
	const rows: string[][] = [];
	let row: string[] = [],
		cell = "",
		quoted = false,
		closed = false;
	const field = () => {
		if (cell.length > 4000) throw new ResourceError("INVALID");
		row.push(cell);
		cell = "";
		closed = false;
		if (row.length > 20) throw new ResourceError("INVALID");
	};
	for (let i = 0; i < text.length; i++) {
		const ch = text[i];
		if (quoted) {
			if (ch === '"') {
				if (text[i + 1] === '"') {
					cell += '"';
					i++;
				} else {
					quoted = false;
					closed = true;
				}
			} else cell += ch;
			continue;
		}
		if (ch === '"') {
			if (cell || closed) throw new ResourceError("INVALID");
			quoted = true;
		} else if (ch === ",") field();
		else if (ch === "\n" || ch === "\r") {
			if (ch === "\r" && text[i + 1] === "\n") i++;
			field();
			rows.push(row);
			row = [];
			if (rows.length > 1001) throw new ResourceError("CAPACITY");
		} else {
			if (closed) throw new ResourceError("INVALID");
			cell += ch;
		}
	}
	if (quoted) throw new ResourceError("INVALID");
	if (cell || row.length || closed) {
		field();
		rows.push(row);
	}
	if (rows.length < 2 || rows.length > 1001) throw new ResourceError("INVALID");
	const headers = rows[0].map((h) => h.replace(/^\uFEFF/, "").trim());
	if (
		new Set(headers).size !== headers.length ||
		headers.some((h) => !h || h.length > 100) ||
		rows.some((r) => r.length !== headers.length)
	)
		throw new ResourceError("INVALID");
	rows[0] = headers;
	return rows;
}
function csvCell(value: unknown) {
	let text = value == null ? "" : String(value);
	// biome-ignore lint/suspicious/noControlCharactersInRegex: CSV formula prefixes can follow control characters.
	if (/^[\s\u0000-\u001f]*[=+@-]/.test(text) || /^[\t\r\n]/.test(text))
		text = `'${text}`;
	return `"${text.replaceAll('"', '""')}"`;
}
export const csvDocument = (headers: string[], rows: unknown[][]) =>
	[headers, ...rows].map((row) => row.map(csvCell).join(",")).join("\r\n") +
	"\r\n";
export function mappedProjects(
	text: string,
	mapping: { name: string; slug: string; description?: string },
) {
	const [headers, ...rows] = parseCsv(text);
	if (
		Object.keys(mapping).some(
			(k) => !["name", "slug", "description"].includes(k),
		) ||
		new Set(Object.values(mapping)).size !== Object.values(mapping).length ||
		Object.values(mapping).some((k) => !headers.includes(k))
	)
		throw new ResourceError("INVALID");
	const slugs = new Set<string>();
	return rows.map((r, i) => {
		const name = r[headers.indexOf(mapping.name)]?.trim() ?? "",
			slug = r[headers.indexOf(mapping.slug)]?.trim() ?? "",
			description = mapping.description
				? r[headers.indexOf(mapping.description)]
				: "";
		const errors: string[] = [];
		if (!name || name.length > 120) errors.push("name");
		if (!/^[a-z0-9][a-z0-9-]{1,62}$/.test(slug)) errors.push("slug");
		if (description.length > 4000) errors.push("description");
		if (slugs.has(slug)) errors.push("duplicate");
		slugs.add(slug);
		return { row: i + 2, name, slug, description, errors };
	});
}

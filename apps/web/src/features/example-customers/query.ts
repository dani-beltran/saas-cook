import {
	type CustomerQuery,
	customerQuery,
} from "@common-saas/api-contracts/example-customers";
export function queryFromUrl(params: {
	get: (key: string) => string | null;
}): CustomerQuery {
	const value = customerQuery.safeParse(
		Object.fromEntries(
			["search", "status", "sort", "direction", "limit"].flatMap((key) => {
				const v = params.get(key);
				return v ? [[key, v]] : [];
			}),
		),
	);
	return value.success ? value.data : customerQuery.parse({});
}
export function queryUrl(query: CustomerQuery) {
	const params = new URLSearchParams();
	for (const [key, value] of Object.entries(query))
		if (value !== undefined && value !== "" && key !== "cursor")
			params.set(key, String(value));
	return params.toString();
}

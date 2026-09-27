/** Synthetic contacts only. No identities, invitations or outgoing messages. */
export function exampleCustomerInputs(count = 90) {
	const names = [
		"Alex Rivera",
		"Beatriz Sol",
		"Cameron Lee",
		"Dalia Martín",
		"Eli Morgan",
		"Fatima Noor",
		"Gabriel Costa",
		"Hana Park",
		"Iris Chen",
		"Jules Petit",
	];
	const companies = [
		"Atlas Studio",
		"Cedar Works",
		"",
		"Northwind Lab",
		"Estudio Sur",
		"Lumen Co",
	];
	return Array.from({ length: count }, (_, i) => ({
		name: `${names[i % names.length]} ${String(i + 1).padStart(3, "0")}`,
		email: `contact.${String(i + 1).padStart(3, "0")}@example.test`,
		company: companies[i % companies.length],
		status: (["lead", "active", "inactive"] as const)[i % 3],
		operationKey: `example-customers-fixture-v1-${i + 1}`,
	}));
}

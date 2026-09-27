"use client";
import type {
	CustomerDto,
	CustomerQuery,
} from "@saas-cook/api-contracts/example-customers";
import type { CustomerCopy } from "./messages";

export function CustomerTable({
	items,
	copy,
	locale,
	query,
	onSort,
	onAction,
}: {
	items: CustomerDto[];
	copy: CustomerCopy;
	locale: string;
	query: CustomerQuery;
	onSort: (sort: CustomerQuery["sort"]) => void;
	onAction: (action: "view" | "edit" | "delete", customer: CustomerDto) => void;
}) {
	const date = new Intl.DateTimeFormat(locale, {
		dateStyle: "medium",
		timeZone: "UTC",
	});
	const heading = (field: CustomerQuery["sort"]) => (
		<th
			scope="col"
			aria-sort={
				query.sort === field
					? query.direction === "asc"
						? "ascending"
						: "descending"
					: "none"
			}
		>
			<button
				id={`customers-sort-${field}`}
				type="button"
				onClick={() => onSort(field)}
			>
				{copy[field]}{" "}
				<span aria-hidden="true">
					{query.sort === field ? (query.direction === "asc" ? "↑" : "↓") : "↕"}
				</span>
			</button>
		</th>
	);
	return (
		<table className="customers-table">
			<caption className="sr-only">{copy.title}</caption>
			<thead>
				<tr>
					{heading("name")}
					<th scope="col">{copy.email}</th>
					{heading("company")}
					<th scope="col">{copy.status}</th>
					{heading("createdAt")}
					<th scope="col">
						<span className="sr-only">{copy.actions}</span>
					</th>
				</tr>
			</thead>
			<tbody>
				{items.map((customer) => (
					<tr key={customer.id}>
						<td data-label={copy.name}>
							<button
								type="button"
								className="customers-name"
								onClick={() => onAction("view", customer)}
								aria-label={`${copy.view}: ${customer.name}`}
							>
								{customer.name}
							</button>
						</td>
						<td data-label={copy.email}>
							<span className="customers-email">{customer.email}</span>
						</td>
						<td data-label={copy.company}>
							{customer.company ?? (
								<span className="customers-muted">{copy.notProvided}</span>
							)}
						</td>
						<td data-label={copy.status}>
							<span className={`customers-badge customers-${customer.status}`}>
								<span aria-hidden="true">●</span>
								{copy[customer.status]}
							</span>
						</td>
						<td data-label={copy.createdAt}>
							<time dateTime={customer.createdAt}>
								{date.format(new Date(customer.createdAt))}
							</time>
						</td>
						<td data-label={copy.actions}>
							<div className="customers-row-actions">
								<button
									type="button"
									onClick={() => onAction("edit", customer)}
									aria-label={`${copy.edit}: ${customer.name}`}
								>
									{copy.edit}
								</button>
								<button
									type="button"
									onClick={() => onAction("delete", customer)}
									aria-label={`${copy.delete}: ${customer.name}`}
								>
									{copy.delete}
								</button>
							</div>
						</td>
					</tr>
				))}
			</tbody>
		</table>
	);
}

"use client";
import type {
	CustomerDto,
	CustomerQuery,
} from "@saas-cook/api-contracts/example-customers";
import {
	Button,
	Table,
	TableBody,
	TableCaption,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@saas-cook/ui";
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
		<TableHead
			scope="col"
			aria-sort={
				query.sort === field
					? query.direction === "asc"
						? "ascending"
						: "descending"
					: "none"
			}
		>
			<Button
				variant="ghost"
				size="plain"
				id={`customers-sort-${field}`}
				type="button"
				onClick={() => onSort(field)}
			>
				{copy[field]}{" "}
				<span aria-hidden="true">
					{query.sort === field ? (query.direction === "asc" ? "↑" : "↓") : "↕"}
				</span>
			</Button>
		</TableHead>
	);
	return (
		<Table className="customers-table">
			<TableCaption className="sr-only">{copy.title}</TableCaption>
			<TableHeader>
				<TableRow>
					{heading("name")}
					<TableHead scope="col">{copy.email}</TableHead>
					{heading("company")}
					<TableHead scope="col">{copy.status}</TableHead>
					{heading("createdAt")}
					<TableHead scope="col">
						<span className="sr-only">{copy.actions}</span>
					</TableHead>
				</TableRow>
			</TableHeader>
			<TableBody>
				{items.map((customer) => (
					<TableRow key={customer.id}>
						<TableCell data-label={copy.name}>
							<Button
								variant="ghost"
								size="plain"
								type="button"
								className="customers-name"
								onClick={() => onAction("view", customer)}
								aria-label={`${copy.view}: ${customer.name}`}
							>
								{customer.name}
							</Button>
						</TableCell>
						<TableCell data-label={copy.email}>
							<span className="customers-email">{customer.email}</span>
						</TableCell>
						<TableCell data-label={copy.company}>
							{customer.company ?? (
								<span className="customers-muted">{copy.notProvided}</span>
							)}
						</TableCell>
						<TableCell data-label={copy.status}>
							<span className={`customers-badge customers-${customer.status}`}>
								<span aria-hidden="true">●</span>
								{copy[customer.status]}
							</span>
						</TableCell>
						<TableCell data-label={copy.createdAt}>
							<time dateTime={customer.createdAt}>
								{date.format(new Date(customer.createdAt))}
							</time>
						</TableCell>
						<TableCell data-label={copy.actions}>
							<div className="customers-row-actions">
								<Button
									variant="ghost"
									size="plain"
									type="button"
									onClick={() => onAction("edit", customer)}
									aria-label={`${copy.edit}: ${customer.name}`}
								>
									{copy.edit}
								</Button>
								<Button
									variant="ghost"
									size="plain"
									type="button"
									onClick={() => onAction("delete", customer)}
									aria-label={`${copy.delete}: ${customer.name}`}
								>
									{copy.delete}
								</Button>
							</div>
						</TableCell>
					</TableRow>
				))}
			</TableBody>
		</Table>
	);
}

import type {
	CustomerDto,
	CustomerQuery,
} from "@common-saas/api-contracts/example-customers";
import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { useLocale } from "next-intl";
import { useState } from "react";
import { CustomerForm } from "./customer-form";
import { CustomerTable } from "./customer-table";
import { customerMessages } from "./messages";
import "../../components/dashboard.css";
import "./customers.css";

const customers: CustomerDto[] = Array.from({ length: 5 }, (_, i) => ({
	id: `00000000-0000-4000-8000-00000000000${i}`,
	organizationId: "00000000-0000-4000-8000-000000000010",
	name: [
		"Alex Rivera",
		"Beatriz Sol",
		"Cameron Lee",
		"Dalia Martín",
		"Eli Morgan",
	][i],
	email: `contact.${i}@example.test`,
	company:
		i === 2
			? null
			: ["Atlas Studio", "Cedar Works", "", "Northwind Lab", "Estudio Sur"][i],
	status: (["lead", "active", "inactive"] as const)[i % 3],
	version: 1,
	createdAt: "2026-09-25T12:00:00.000Z",
	updatedAt: "2026-09-25T12:00:00.000Z",
	deletedAt: null,
}));
function Example({ mode }: { mode: "table" | "form" | "pending" | "failure" }) {
	const locale = useLocale(),
		copy = customerMessages[locale === "es" ? "es" : "en"];
	const [query, setQuery] = useState<CustomerQuery>({
		search: "",
		sort: "createdAt",
		direction: "desc",
		limit: 25,
	});
	const [message, setMessage] = useState("");
	return (
		<div
			className="dashboard-shell"
			style={{ display: "block", minHeight: 0, padding: 24 }}
		>
			<section className="customers-feature">
				<p className="customers-eyebrow">{copy.example}</p>
				<h1>{copy.title}</h1>
				{mode === "table" ? (
					<div className="customers-panel" style={{ marginTop: 24 }}>
						<CustomerTable
							items={customers}
							locale={locale}
							copy={copy}
							query={query}
							onSort={(sort) =>
								setQuery({
									...query,
									sort,
									direction: query.direction === "asc" ? "desc" : "asc",
								})
							}
							onAction={(action) => setMessage(copy[action])}
						/>
					</div>
				) : (
					<div style={{ maxWidth: 440, marginTop: 24 }}>
						{mode === "failure" && (
							<p role="alert" className="customers-error customers-notice">
								{copy.failed}
							</p>
						)}
						<CustomerForm
							copy={copy}
							busy={mode === "pending"}
							initial={
								mode === "failure"
									? {
											name: "Beatriz Sol",
											email: "beatriz@example.test",
											company: "Cedar Works",
											status: "active",
										}
									: undefined
							}
							onCancel={() => setMessage(copy.cancel)}
							onSave={async () =>
								setMessage(mode === "failure" ? copy.failed : copy.saved)
							}
						/>
					</div>
				)}
				<p role="status">{message}</p>
			</section>
		</div>
	);
}
const meta = {
	title: "Example business features/Customers",
	component: Example,
	parameters: { layout: "fullscreen", dashboard: true },
} satisfies Meta<typeof Example>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Directory: Story = { args: { mode: "table" } };
export const SpanishDirectory: Story = {
	args: { mode: "table" },
	globals: { locale: "es" },
};
export const DarkDirectory: Story = {
	args: { mode: "table" },
	globals: { theme: "dark" },
};
export const CreateValidation: Story = { args: { mode: "form" } };
export const Pending: Story = { args: { mode: "pending" } };
export const RecoverableFailure: Story = { args: { mode: "failure" } };

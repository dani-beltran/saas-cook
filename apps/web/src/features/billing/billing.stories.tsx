import type { BillingSnapshot } from "@saas-cook/api-contracts";
import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { BillingOverview } from "./billing";

const data: BillingSnapshot = {
	enabled: false,
	sourceVersion: 0,
	planVersionId: null,
	providerStatus: "none",
	accessState: "free",
	health: "local",
	snapshotValidUntil: null,
	reconciledAt: null,
	periodEnd: null,
	trialEnd: null,
	graceEnd: null,
	cancelAt: null,
	scheduled: null,
	seats: { capacity: 5, occupied: 2, overCapacity: false },
	plans: [],
	invoices: [],
	commands: [],
	usage: {
		metric: "projects.created",
		metricVersion: 1,
		unit: "project",
		periodStart: "2026-09-01T00:00:00Z",
		periodEnd: "2026-10-01T00:00:00Z",
		consumed: 80,
		reserved: 1,
		policy: { kind: "limited", limit: 100 },
		watermark: 80,
		providerCharging: false,
	},
};
const meta = {
	title: "Commercial/Billing and usage",
	component: BillingOverview,
	args: { data, locale: "en" },
	decorators: [
		(Story) => (
			<div className="billing-page">
				<Story />
			</div>
		),
	],
} satisfies Meta<typeof BillingOverview>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Foundation: Story = {};
export const Spanish: Story = { args: { locale: "es" } };
export const Pending: Story = {
	args: {
		data: {
			...data,
			enabled: true,
			commands: [
				{
					id: "00000000-0000-4000-8000-000000000001",
					kind: "checkout",
					state: "pending",
					errorCode: null,
					url: null,
				},
			],
		},
	},
};
export const OverCapacityAndOutage: Story = {
	args: {
		data: {
			...data,
			enabled: true,
			accessState: "restricted",
			providerStatus: "unpaid",
			health: "outage",
			seats: { capacity: 1, occupied: 3, overCapacity: true },
		},
	},
};
export const QuotaReached: Story = {
	args: {
		usageOnly: true,
		data: { ...data, usage: { ...data.usage, consumed: 100, reserved: 0 } },
	},
};

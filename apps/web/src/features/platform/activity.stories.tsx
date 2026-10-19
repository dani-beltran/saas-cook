import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { ActivityView } from "./activity";

const meta = {
	title: "Platform/Activity",
	component: ActivityView,
	args: { failed: false, onRetry: () => {}, onNext: () => {} },
	parameters: { layout: "padded" },
} satisfies Meta<typeof ActivityView>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Loading: Story = {};
export const Empty: Story = { args: { page: { items: [], nextCursor: null } } };
export const Denied: Story = { args: { failed: true } };
export const Recent: Story = {
	args: {
		page: {
			items: [
				{
					id: "fca605bc-b278-40b8-8911-abd0b2ad4d90",
					action: "updated",
					actor: "member",
					occurredAt: "2026-10-19T10:00:00.000Z",
					schemaVersion: 1,
				},
				{
					id: "97b0523d-f22b-4388-8460-bc5e62c63661",
					action: "created",
					actor: "service",
					occurredAt: "2026-10-18T09:00:00.000Z",
					schemaVersion: 1,
				},
			],
			nextCursor: "synthetic-continuation",
		},
	},
};

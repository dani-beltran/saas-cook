import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { expect, fn, userEvent, within } from "storybook/test";
import { ProjectForm } from "./project-form";

const meta = {
	title: "Projects/Localized form",
	component: ProjectForm,
	args: { onSave: fn(async () => undefined) },
	parameters: { layout: "padded" },
} satisfies Meta<typeof ProjectForm>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Create: Story = {};
export const Spanish: Story = { globals: { locale: "es" } };
export const Dark: Story = { globals: { theme: "dark" } };
export const Saving: Story = { args: { busy: true } };
export const Editing: Story = {
	args: {
		initial: {
			name: "Website refresh",
			slug: "website-refresh",
			description: "A synthetic project for the shared form.",
			status: "active",
			workspaceId: "",
		},
	},
};
export const Invalid: Story = {
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		await userEvent.click(canvas.getByRole("button"));
		await expect(canvas.getAllByRole("alert")).toHaveLength(2);
	},
};
export const SpanishInvalid: Story = { ...Invalid, globals: { locale: "es" } };

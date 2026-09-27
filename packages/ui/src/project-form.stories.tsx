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
		},
	},
};
export const Invalid: Story = {
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		await userEvent.click(canvas.getByRole("button"));
		await expect(canvas.getAllByRole("alert")).toHaveLength(2);
		await expect(canvas.getByLabelText("Name", { exact: true })).toHaveFocus();
	},
};
export const SpanishInvalid: Story = {
	globals: { locale: "es" },
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		await userEvent.click(canvas.getByRole("button"));
		await expect(canvas.getAllByRole("alert")).toHaveLength(2);
		await expect(
			canvas.getByLabelText("Nombre", { exact: true }),
		).toHaveFocus();
	},
};
export const PendingEdit: Story = {
	...Editing,
	args: { ...Editing.args, busy: true, onCancel: fn() },
	globals: { theme: "dark" },
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		await expect(
			canvas.getByRole("button", { name: "Saving…" }),
		).toBeDisabled();
		await expect(canvas.getByRole("button", { name: "Cancel" })).toBeDisabled();
		await expect(canvas.getByLabelText("Name", { exact: true })).toHaveValue(
			"Website refresh",
		);
	},
};
export const CreateUnderOrganization: Story = {
	play: async ({ canvasElement, args }) => {
		const canvas = within(canvasElement);
		await userEvent.type(
			canvas.getByLabelText("Name", { exact: true }),
			"Website refresh",
		);
		await userEvent.type(
			canvas.getByLabelText("Slug", { exact: true }),
			"website-refresh",
		);
		await userEvent.click(
			canvas.getByRole("button", { name: "Create project" }),
		);
		await expect(args.onSave).toHaveBeenCalledWith({
			name: "Website refresh",
			slug: "website-refresh",
			description: "",
			status: "active",
		});
	},
};

import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { useState } from "react";
import { expect, fn, userEvent, within } from "storybook/test";
import { Button } from "./button";
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
export const WorkspaceAssignment: Story = {
	args: {
		workspaces: [
			{ id: "design", name: "Design studio", archivedAt: null },
			{ id: "archive", name: "Archived studio", archivedAt: "2026-01-01" },
		],
	},
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
		await expect(
			canvas.queryByRole("option", { name: "Archived studio" }),
		).toBeNull();
		await userEvent.selectOptions(
			canvas.getByLabelText("Workspace", { exact: true }),
			"design",
		);
		await userEvent.click(
			canvas.getByRole("button", { name: "Create project" }),
		);
		await expect(args.onSave).toHaveBeenCalledWith({
			name: "Website refresh",
			slug: "website-refresh",
			description: "",
			workspaceId: "design",
			status: "active",
		});
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
export const WorkspaceRemovedWhileDrafting: Story = {
	render: function WorkspaceRemoved(args) {
		const [available, setAvailable] = useState(true);
		return (
			<div className="grid gap-5">
				<Button onClick={() => setAvailable(false)} disabled={!available}>
					Remove workspace from available choices
				</Button>
				<ProjectForm
					{...args}
					workspaces={
						available
							? [{ id: "design", name: "Design studio", archivedAt: null }]
							: []
					}
				/>
			</div>
		);
	},
	play: async ({ canvasElement, args }) => {
		const canvas = within(canvasElement);
		await userEvent.type(
			canvas.getByLabelText("Name", { exact: true }),
			"Preserved draft",
		);
		await userEvent.type(
			canvas.getByLabelText("Slug", { exact: true }),
			"preserved-draft",
		);
		await userEvent.selectOptions(
			canvas.getByLabelText("Workspace", { exact: true }),
			"design",
		);
		await userEvent.click(
			canvas.getByRole("button", {
				name: "Remove workspace from available choices",
			}),
		);
		await expect(
			canvas.getByLabelText("Workspace", { exact: true }),
		).toHaveValue("design");
		await expect(
			canvas.getByRole("option", { name: "Selected workspace is unavailable" }),
		).toBeDisabled();
		await userEvent.click(
			canvas.getByRole("button", { name: "Create project" }),
		);
		await expect(canvas.getByRole("alert")).toHaveTextContent(
			"Choose an available workspace, or select No workspace.",
		);
		await expect(args.onSave).not.toHaveBeenCalled();
		await expect(canvas.getByLabelText("Name", { exact: true })).toHaveValue(
			"Preserved draft",
		);
		await userEvent.selectOptions(
			canvas.getByLabelText("Workspace", { exact: true }),
			"",
		);
		await userEvent.click(
			canvas.getByRole("button", { name: "Create project" }),
		);
		await expect(args.onSave).toHaveBeenCalledWith({
			name: "Preserved draft",
			slug: "preserved-draft",
			description: "",
			workspaceId: "",
			status: "active",
		});
	},
};

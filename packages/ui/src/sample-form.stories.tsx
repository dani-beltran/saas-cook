import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { expect, userEvent, within } from "storybook/test";
import { SampleForm } from "./sample-form";

const meta = {
	title: "Foundation/Localized form",
	component: SampleForm,
	parameters: { layout: "fullscreen" },
} satisfies Meta<typeof SampleForm>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Empty: Story = {};
export const Spanish: Story = { globals: { locale: "es" } };
export const Dark: Story = { globals: { mode: "dark" } };
export const Invalid: Story = {
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		await userEvent.click(canvas.getByRole("button"));
		await expect(canvas.getByRole("alert")).toBeVisible();
		await expect(canvas.getByRole("textbox")).toHaveAttribute(
			"aria-invalid",
			"true",
		);
	},
};
export const SpanishInvalid: Story = { ...Invalid, globals: { locale: "es" } };
export const Valid: Story = {
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		await userEvent.type(canvas.getByRole("textbox"), "Synthetic project");
		await userEvent.click(canvas.getByRole("button"));
		await expect(canvas.getByRole("status")).toBeVisible();
	},
};

import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { expect, fn, userEvent, within } from "storybook/test";
import { AppearanceChoices } from "./personal-settings";
import "./account-dashboard.css";

const meta = {
	title: "Account/Appearance",
	component: AppearanceChoices,
	args: { value: "system", onChange: fn() },
	decorators: [
		(Story) => (
			<div className="account-dashboard" style={{ maxWidth: 580, padding: 24 }}>
				<Story />
			</div>
		),
	],
} satisfies Meta<typeof AppearanceChoices>;
export default meta;
type Story = StoryObj<typeof meta>;
export const System: Story = {};
export const Light: Story = { args: { value: "light" } };
export const Dark: Story = { args: { value: "dark" } };
export const Loading: Story = { args: { disabled: true } };
export const Spanish: Story = { globals: { locale: "es" } };
export const Keyboard: Story = {
	play: async ({ canvasElement, args }) => {
		const canvas = within(canvasElement);
		canvas.getByRole("radio", { name: "System" }).focus();
		await userEvent.keyboard("{ArrowLeft}");
		await expect(args.onChange).toHaveBeenCalledWith("dark");
	},
};

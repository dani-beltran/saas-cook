import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { expect, fn, userEvent, within } from "storybook/test";
import { DashboardFrame } from "./dashboard-shell";

const meta = {
	title: "Dashboard/Navigation",
	component: DashboardFrame,
	parameters: { layout: "fullscreen", dashboard: true },
	args: {
		section: "projects",
		organizationId: "north-studio",
		organizations: [
			{ id: "north-studio", name: "North Studio" },
			{ id: "south-studio", name: "South Studio" },
		],
		state: "ready",
		user: { name: "Alex Morgan", email: "alex@example.test" },
		onRetry: fn(),
		children: (
			<header className="dashboard-page-header">
				<div>
					<p className="dashboard-eyebrow">North Studio</p>
					<h1>Projects</h1>
					<p className="dashboard-description">
						A place to organize your team's projects.
					</p>
				</div>
			</header>
		),
	},
} satisfies Meta<typeof DashboardFrame>;
export default meta;
type Story = StoryObj<typeof meta>;
export const OrganizationContext: Story = {};
export const PersonalAccount: Story = {
	args: {
		section: "account",
		organizationId: undefined,
		children: (
			<header className="dashboard-page-header">
				<div>
					<p className="dashboard-eyebrow">Personal</p>
					<h1>Your account</h1>
					<p className="dashboard-description">
						Your identity, organizations and account security.
					</p>
				</div>
			</header>
		),
	},
};
export const Loading: Story = { args: { organizations: [], state: "loading" } };
export const RetryUnavailable: Story = {
	args: { organizations: [], state: "error" },
	play: async ({ canvasElement, args }) => {
		const canvas = within(canvasElement);
		await userEvent.click(canvas.getByRole("button", { name: "Try again" }));
		await expect(args.onRetry).toHaveBeenCalled();
	},
};
export const Spanish: Story = {
	globals: { locale: "es" },
	args: {
		children: (
			<header className="dashboard-page-header">
				<div>
					<p className="dashboard-eyebrow">North Studio</p>
					<h1>Proyectos</h1>
					<p className="dashboard-description">
						Un espacio para organizar el trabajo de tu equipo.
					</p>
				</div>
			</header>
		),
	},
};
export const Appearance: Story = {
	globals: { mode: "dark", palette: "violet", density: "compact" },
	play: async ({ canvasElement }) => {
		await expect(canvasElement.ownerDocument.documentElement).toHaveAttribute(
			"data-mode",
			"dark",
		);
		await expect(
			within(canvasElement).queryByRole("button", {
				name: "Toggle color theme",
			}),
		).not.toBeInTheDocument();
	},
};

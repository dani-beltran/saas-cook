import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { ValidationForm } from "./ValidationForm";
const meta = {
	title: "Phase 0/Form compatibility",
	component: ValidationForm,
} satisfies Meta<typeof ValidationForm>;
export default meta;
export const Empty: StoryObj<typeof meta> = {};

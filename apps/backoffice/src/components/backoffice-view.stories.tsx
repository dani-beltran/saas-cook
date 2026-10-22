import { zodResolver } from "@hookform/resolvers/zod";
import { organizationLookupInput } from "@saas-cook/backoffice-contracts";
import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { NextIntlClientProvider, useLocale } from "next-intl";
import type { ComponentProps } from "react";
import { useForm } from "react-hook-form";
import en from "../i18n/messages/en/backoffice.json";
import es from "../i18n/messages/es/backoffice.json";
import "../app/style.css";
import { BackofficeView } from "./backoffice-view";

type Props = Pick<
	ComponentProps<typeof BackofficeView>,
	"busy" | "status" | "result"
>;
function Preview(props: Props) {
	const locale = useLocale();
	const form = useForm({
		resolver: zodResolver(organizationLookupInput),
		defaultValues: { organizationId: "", caseReference: "" },
	});
	return (
		<NextIntlClientProvider
			locale={locale}
			messages={locale === "es" ? es : en}
			timeZone="UTC"
		>
			<BackofficeView
				{...props}
				form={form}
				invitation=""
				onInvitationChange={() => {}}
				onSignIn={() => {}}
				onEnroll={() => {}}
				onSignOut={() => {}}
				onLookup={async () => {}}
				onInvalid={() => {}}
			/>
		</NextIntlClientProvider>
	);
}
const meta = {
	title: "Backoffice/Workspace",
	component: Preview,
	parameters: { layout: "fullscreen", dashboard: true },
	args: { busy: false, status: "empty", result: null },
} satisfies Meta<typeof Preview>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Empty: Story = {};
export const Pending: Story = { args: { busy: true, status: "working" } };
export const Denied: Story = { args: { status: "denied" } };
export const Organization: Story = {
	args: {
		status: "ready",
		result: {
			id: "11111111-1111-4111-8111-111111111111",
			name: "North Studio",
			lifecycle: "active",
			seats: { occupied: 3, capacity: 10 },
			sourceTimestamp: "2026-10-22T12:00:00Z",
			auditReference: "22222222-2222-4222-8222-222222222222",
		},
	},
};
export const Spanish: Story = { globals: { locale: "es" } };
export const Dark: Story = {
	globals: { mode: "dark" },
	args: Organization.args,
};

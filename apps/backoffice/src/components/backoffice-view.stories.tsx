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
import {
	DirectoryResults,
	OrganizationDirectory,
} from "./organization-directory";

type Props = Pick<
	ComponentProps<typeof BackofficeView>,
	"busy" | "status" | "result" | "authenticated" | "checking" | "page"
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
				directory={<OrganizationDirectory disabled={props.busy} />}
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
	args: { busy: false, status: "empty", result: null, authenticated: false },
} satisfies Meta<typeof Preview>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Empty: Story = {};
export const Pending: Story = { args: { busy: true, status: "working" } };
export const Denied: Story = { args: { status: "denied" } };
export const Organization: Story = {
	args: {
		status: "ready",
		authenticated: true,
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

export const Directory: Story = {
	render: () => (
		<NextIntlClientProvider locale="en" messages={en} timeZone="UTC">
			<DirectoryResults
				result={{
					items: [
						{
							id: "11111111-1111-4111-8111-111111111111",
							name: "North Studio",
							lifecycle: "active",
							sourceTimestamp: "2026-10-22T12:00:00Z",
						},
					],
					nextCursor: null,
					freshness: { kind: "live", checkedAt: "2026-10-22T12:00:01Z" },
					auditReference: "22222222-2222-4222-8222-222222222222",
				}}
			/>
		</NextIntlClientProvider>
	),
};
export const EmptyDirectoryContinuation: Story = {
	render: () => (
		<NextIntlClientProvider locale="en" messages={en} timeZone="UTC">
			<DirectoryResults
				result={{
					items: [],
					nextCursor: "opaque-example",
					freshness: { kind: "live", checkedAt: "2026-10-22T12:00:01Z" },
					auditReference: "22222222-2222-4222-8222-222222222222",
				}}
			/>
		</NextIntlClientProvider>
	),
};

export const CheckingSession: Story = {
	args: { busy: true, checking: true },
	render: (args) => <Preview {...args} />,
};
export const AuthenticatedEmpty: Story = {
	args: { authenticated: true, status: "ready" },
};

export const StaffAccess: Story = {
	args: { authenticated: true, page: "staff-access" },
};

export const OrganizationDetail: Story = {
	args: { ...Organization.args, page: "organization-detail" },
};

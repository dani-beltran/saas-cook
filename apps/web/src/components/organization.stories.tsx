import type { OrganizationSnapshotDto } from "@common-saas/api-contracts";
import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { NextIntlClientProvider, useLocale, useTranslations } from "next-intl";
import { useState } from "react";
import { accountMessages } from "../i18n/account";
import { organizationDashboardCopy } from "../i18n/organization-dashboard";
import { ConfirmDialog, MemberRow, TeamCard } from "./organization";
import "./dashboard.css";

const membership = {
	id: "00000000-0000-4000-8000-000000000001",
	userId: "synthetic-owner",
	email: "alex@example.test",
	role: "owner" as const,
	status: "active",
	billable: true,
};
const otherMember = {
	...membership,
	id: "00000000-0000-4000-8000-000000000002",
	userId: "synthetic-member",
	email: "maria@example.test",
	role: "member" as const,
};
const team = {
	id: "00000000-0000-4000-8000-000000000003",
	name: "Product design",
	membershipIds: [membership.id],
};
const initial: OrganizationSnapshotDto = {
	organization: {
		id: "00000000-0000-4000-8000-000000000004",
		name: "Synthetic studio",
		slug: "synthetic-studio",
		status: "active",
	},
	membership,
	members: [membership, otherMember],
	invitations: [],
	teams: [team],
	transfers: [],
	seats: { occupied: 2, capacity: 5 },
};

function OrganizationExample({
	mode,
}: {
	mode: "members" | "team" | "empty-team";
}) {
	const locale = useLocale() === "es" ? "es" : "en";
	const copy = organizationDashboardCopy[locale];
	const t = useTranslations("Account");
	const [snapshot, setSnapshot] = useState<OrganizationSnapshotDto>({
		...initial,
		teams: [
			{
				...team,
				membershipIds: mode === "empty-team" ? [] : team.membershipIds,
			},
		],
	});
	const [confirmation, setConfirmation] =
		useState<Parameters<typeof ConfirmDialog>[0]["value"]>(null);
	const [message, setMessage] = useState("");
	const run: Parameters<typeof MemberRow>[0]["run"] = async (_scope, value) => {
		setSnapshot((current) => ({
			...current,
			members:
				value.action === "membership"
					? current.members.map((member) =>
							member.id === value.membershipId
								? { ...member, role: value.role, status: value.status }
								: member,
						)
					: current.members,
			teams:
				value.action === "removeTeam"
					? []
					: current.teams.map((item) => ({
							...item,
							membershipIds:
								value.action === "addTeamMember"
									? [...item.membershipIds, value.membershipId]
									: value.action === "removeTeamMember"
										? item.membershipIds.filter(
												(id) => id !== value.membershipId,
											)
										: item.membershipIds,
						})),
		}));
		setMessage(t("saved"));
		setConfirmation(null);
		return true;
	};
	const confirm: Parameters<typeof MemberRow>[0]["confirm"] = (
		scope,
		value,
		description,
		title = copy.confirmChange,
	) => setConfirmation({ scope, value, description, title });
	return (
		<div
			className="dashboard-shell"
			style={{ display: "block", minHeight: 400 }}
		>
			<div className="org-page" style={{ padding: 24 }}>
				<div className="dashboard-section-heading">
					<h2>{t(mode === "members" ? "members" : "teams")}</h2>
					<p className="dashboard-description">
						{mode === "members"
							? copy.membersDescription
							: copy.teamsDescription}
					</p>
				</div>
				{message && (
					<p className="dashboard-notice" role="status">
						{message}
					</p>
				)}
				{mode === "members" ? (
					<ul className="org-members">
						{snapshot.members.map((member) => (
							<MemberRow
								key={member.id}
								member={member}
								currentId={membership.id}
								busy={false}
								run={run}
								confirm={confirm}
							/>
						))}
					</ul>
				) : (
					snapshot.teams.map((item) => (
						<TeamCard
							key={item.id}
							team={item}
							snapshot={snapshot}
							busy={false}
							run={run}
							confirm={confirm}
						/>
					))
				)}
				<ConfirmDialog
					value={confirmation}
					busy={false}
					feedback={null}
					onCancel={() => setConfirmation(null)}
					onConfirm={() => {
						if (confirmation) void run(confirmation.scope, confirmation.value);
					}}
				/>
			</div>
		</div>
	);
}

const meta = {
	title: "Dashboard/Organization interactions",
	component: OrganizationExample,
	parameters: { layout: "padded" },
	decorators: [
		(Story, context) => {
			const locale = context.globals.locale === "es" ? "es" : "en";
			return (
				<NextIntlClientProvider
					locale={locale}
					messages={{ Account: accountMessages[locale] }}
					timeZone="UTC"
				>
					<Story />
				</NextIntlClientProvider>
			);
		},
	],
} satisfies Meta<typeof OrganizationExample>;
export default meta;
type Story = StoryObj<typeof meta>;

export const MemberActions: Story = { args: { mode: "members" } };
export const TeamMembership: Story = { args: { mode: "team" } };
export const EmptyTeam: Story = { args: { mode: "empty-team" } };
export const SpanishMembers: Story = {
	args: { mode: "members" },
	globals: { locale: "es" },
};
export const DarkTeam: Story = {
	args: { mode: "team" },
	globals: { theme: "dark" },
};

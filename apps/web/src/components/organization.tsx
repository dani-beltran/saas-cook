"use client";
import { createApiClient } from "@common-saas/api/client";
import type {
	OrganizationCommand,
	OrganizationSnapshotDto,
} from "@common-saas/api-contracts";
import { Button, Input } from "@common-saas/ui";
import { useLocale, useTranslations } from "next-intl";
import { useCallback, useEffect, useState } from "react";

export function Organization({ organizationId }: { organizationId: string }) {
	const locale = useLocale();
	const t = useTranslations("Account");
	const projects = useTranslations("Projects");
	const [snapshot, setSnapshot] = useState<OrganizationSnapshotDto | null>(
		null,
	);
	const [summary, setSummary] = useState<{
		organization: { name: string };
		membership: { role: string };
	} | null>(null);
	const [message, setMessage] = useState("");
	const [busy, setBusy] = useState(false);
	const [acceptance, setAcceptance] = useState<{
		kind: "invite" | "transfer";
		value: string;
	} | null>(null);
	const refresh = useCallback(async () => {
		const api = createApiClient(`${window.location.origin}/api/rpc`);
		const own = await api.organizations.summary({ organizationId });
		setSummary(own);
		if (["owner", "admin"].includes(own.membership.role))
			setSnapshot(await api.organizations.get({ organizationId }));
		else setSnapshot(null);
	}, [organizationId]);
	useEffect(() => {
		const query = new URLSearchParams(window.location.search);
		const invite = query.get("invite");
		const transfer = query.get("transfer");
		if (invite || transfer) {
			setAcceptance({
				kind: invite ? "invite" : "transfer",
				value: invite ?? transfer ?? "",
			});
			window.history.replaceState(null, "", window.location.pathname);
		}
		void refresh().catch(() => setMessage(t("permission")));
	}, [refresh, t]);
	async function command(value: OrganizationCommand) {
		setBusy(true);
		setMessage("");
		try {
			await createApiClient(
				`${window.location.origin}/api/rpc`,
			).organizations.command({ organizationId, command: value });
			setMessage(t("saved"));
			setAcceptance(null);
			await refresh();
		} catch (error) {
			const failure = error as { code?: string; message?: string };
			setMessage(
				t(
					failure.message === "CAPACITY"
						? "capacityDenied"
						: failure.message === "LAST_OWNER"
							? "lastOwnerDenied"
							: failure.code === "CONFLICT"
								? "conflict"
								: failure.code === "FORBIDDEN"
									? "permission"
									: failure.code === "UNAUTHORIZED"
										? "reauthenticate"
										: "operationFailed",
				),
			);
		} finally {
			setBusy(false);
		}
	}
	const operationKey = () => crypto.randomUUID();
	return (
		<main className="mx-auto max-w-5xl space-y-8 p-6 sm:p-12">
			<a className="underline" href={`/${locale}/account`}>
				{t("back")}
			</a>
			<h1 className="text-3xl font-semibold">
				{summary?.organization.name ?? t("organizations")}
			</h1>
			<a
				className="inline-flex rounded-md bg-primary px-4 py-2 text-primary-foreground"
				href={`/${locale}/organizations/${organizationId}/projects`}
			>
				{projects("openProjects")}
			</a>
			<p role="status" aria-live="polite">
				{message}
			</p>
			{acceptance && (
				<section className="space-y-4 rounded-xl border border-border p-6">
					<h2>
						{t(
							acceptance.kind === "invite"
								? "inviteReceived"
								: "transferReceived",
						)}
					</h2>
					<p>{t("reauthenticate")}</p>
					<Button
						disabled={busy}
						onClick={() =>
							void command(
								acceptance.kind === "invite"
									? {
											action: "acceptInvitation",
											token: acceptance.value,
											operationKey: operationKey(),
										}
									: {
											action: "acceptTransfer",
											transferId: acceptance.value,
											operationKey: operationKey(),
										},
							)
						}
					>
						{t("accept")}
					</Button>
				</section>
			)}
			{summary && !snapshot && (
				<p>
					{t("role")}: {summary.membership.role}
				</p>
			)}
			{snapshot ? (
				<>
					<p>
						{t("seats")}: {snapshot.seats.occupied} / {snapshot.seats.capacity}
					</p>
					<section className="space-y-4 rounded-xl border border-border p-6">
						<h2 className="text-xl font-semibold">{t("members")}</h2>
						<div className="overflow-x-auto">
							<table className="w-full text-left">
								<thead>
									<tr>
										<th className="p-2">{t("membership")}</th>
										<th className="p-2">{t("role")}</th>
										<th className="p-2">{t("status")}</th>
										<th />
									</tr>
								</thead>
								<tbody>
									{snapshot.members.map((member) => (
										<tr key={member.id}>
											<td className="p-2 break-all">{member.email}</td>
											<td className="p-2">
												<select
													className="min-h-10 rounded border border-input p-2"
													aria-label={`${t("role")} ${member.email}`}
													value={member.role}
													disabled={busy}
													onChange={(event) => {
														const role = event.target
															.value as typeof member.role;
														void command({
															action: "membership",
															membershipId: member.id,
															status:
																member.status === "active"
																	? "active"
																	: "inactive",
															role,
															billable: role !== "billing",
															operationKey: operationKey(),
														});
													}}
												>
													{member.role === "owner" && (
														<option value="owner">{t("owner")}</option>
													)}
													<option value="admin">{t("admin")}</option>
													<option value="member">{t("member")}</option>
													<option value="billing">{t("billing")}</option>
												</select>
											</td>
											<td className="p-2">{member.status}</td>
											<td className="p-2">
												<Button
													disabled={busy}
													onClick={() =>
														void command({
															action: "membership",
															membershipId: member.id,
															role: member.role,
															billable: member.billable,
															status:
																member.status === "active"
																	? "inactive"
																	: "active",
															operationKey: operationKey(),
														})
													}
												>
													{t(
														member.status === "active" ? "suspend" : "activate",
													)}
												</Button>
											</td>
										</tr>
									))}
								</tbody>
							</table>
						</div>
					</section>
					<section className="space-y-4 rounded-xl border border-border p-6">
						<h2 className="text-xl font-semibold">{t("invitations")}</h2>
						<form
							className="flex flex-wrap items-end gap-3"
							onSubmit={(event) => {
								event.preventDefault();
								const data = new FormData(event.currentTarget);
								void command({
									action: "invite",
									email: String(data.get("email")),
									role: data.get("role") as "admin" | "member" | "billing",
									operationKey: operationKey(),
								});
							}}
						>
							<label className="grid gap-2" htmlFor="invitation-email">
								{t("email")}
								<Input
									id="invitation-email"
									name="email"
									type="email"
									required
								/>
							</label>
							<label className="grid gap-2">
								{t("role")}
								<select
									className="min-h-10 rounded border border-input p-2"
									name="role"
								>
									<option value="member">{t("member")}</option>
									<option value="admin">{t("admin")}</option>
									<option value="billing">{t("billing")}</option>
								</select>
							</label>
							<Button type="submit" disabled={busy}>
								{t("invite")}
							</Button>
						</form>
						<ul>
							{snapshot.invitations.map((invite) => (
								<li className="break-all py-2" key={invite.id}>
									{invite.email} · {invite.status}{" "}
									{invite.status === "pending" && (
										<Button
											disabled={busy}
											onClick={() =>
												void command({
													action: "cancelInvitation",
													invitationId: invite.id,
													operationKey: operationKey(),
												})
											}
										>
											{t("cancel")}
										</Button>
									)}
								</li>
							))}
						</ul>
					</section>
					<section className="space-y-4 rounded-xl border border-border p-6">
						<h2 className="text-xl font-semibold">{t("teams")}</h2>
						<form
							className="flex flex-wrap items-end gap-3"
							onSubmit={(event) => {
								event.preventDefault();
								const data = new FormData(event.currentTarget);
								void command({
									action: "createTeam",
									name: String(data.get("name")),
									operationKey: operationKey(),
								});
							}}
						>
							<label className="grid gap-2" htmlFor="team-name">
								{t("team")}
								<Input id="team-name" name="name" required maxLength={80} />
							</label>
							<Button type="submit" disabled={busy}>
								{t("createTeam")}
							</Button>
						</form>
						{snapshot.teams.map((team) => {
							const members = snapshot.members.filter((member) =>
								team.membershipIds.includes(member.id),
							);
							const available = snapshot.members.filter(
								(member) =>
									member.status === "active" &&
									!team.membershipIds.includes(member.id),
							);
							return (
								<article
									className="min-w-0 space-y-4 rounded-lg border border-border p-4"
									key={team.id}
									aria-label={t("teamDetails", { name: team.name })}
								>
									<div className="flex flex-wrap items-center justify-between gap-3">
										<h3 className="min-w-0 break-words text-lg font-semibold">
											{team.name}
										</h3>
										<Button
											disabled={busy}
											aria-label={t("removeTeamNamed", { name: team.name })}
											onClick={() =>
												void command({
													action: "removeTeam",
													teamId: team.id,
													operationKey: operationKey(),
												})
											}
										>
											{t("removeTeam")}
										</Button>
									</div>
									{members.length ? (
										<ul className="space-y-2">
											{members.map((member) => (
												<li
													className="flex flex-wrap items-center justify-between gap-3"
													key={member.id}
												>
													<span className="break-all">{member.email}</span>
													<Button
														disabled={busy}
														aria-label={t("removeTeamMemberNamed", {
															email: member.email,
															team: team.name,
														})}
														onClick={() =>
															void command({
																action: "removeTeamMember",
																teamId: team.id,
																membershipId: member.id,
																operationKey: operationKey(),
															})
														}
													>
														{t("removeTeamMember")}
													</Button>
												</li>
											))}
										</ul>
									) : (
										<p>{t("teamEmpty")}</p>
									)}
									{available.length > 0 && (
										<form
											className="flex flex-wrap items-end gap-3"
											onSubmit={(event) => {
												event.preventDefault();
												const data = new FormData(event.currentTarget);
												void command({
													action: "addTeamMember",
													teamId: team.id,
													membershipId: String(data.get("membershipId")),
													operationKey: operationKey(),
												});
											}}
										>
											<div className="grid min-w-0 max-w-full flex-1 basis-64 gap-2">
												<label htmlFor={`team-member-${team.id}`}>
													{t("membership")}
												</label>
												<select
													id={`team-member-${team.id}`}
													className="min-h-10 w-full min-w-0 max-w-full rounded border border-input p-2"
													name="membershipId"
												>
													{available.map((member) => (
														<option key={member.id} value={member.id}>
															{member.email}
														</option>
													))}
												</select>
											</div>
											<Button type="submit" disabled={busy}>
												{t("addTeamMember")}
											</Button>
										</form>
									)}
								</article>
							);
						})}
					</section>
					{snapshot.membership.role === "owner" && (
						<section className="space-y-5 rounded-xl border border-border p-6">
							<h2 className="text-xl font-semibold">{t("security")}</h2>
							<p>{t("policyAssurance")}</p>
							<form
								className="grid gap-4"
								onSubmit={(event) => {
									event.preventDefault();
									const data = new FormData(event.currentTarget);
									void command({
										action: "securityPolicy",
										requireMfa: data.has("requireMfa"),
										acceptPasskeyMfa: data.has("acceptPasskeyMfa"),
										requiredAuthMethod: data.has("passkeyOnly")
											? "passkey"
											: null,
										operationKey: operationKey(),
									});
								}}
							>
								<label className="flex gap-3">
									<input
										type="checkbox"
										name="requireMfa"
										defaultChecked={
											snapshot.organization.securityPolicy?.requireMfa
										}
									/>
									{t("requireMfa")}
								</label>
								<label className="flex gap-3">
									<input
										type="checkbox"
										name="acceptPasskeyMfa"
										defaultChecked={
											snapshot.organization.securityPolicy?.acceptPasskeyMfa
										}
									/>
									{t("acceptPasskeyMfa")}
								</label>
								<label className="flex gap-3">
									<input
										type="checkbox"
										name="passkeyOnly"
										defaultChecked={
											snapshot.organization.securityPolicy
												?.requiredAuthMethod === "passkey"
										}
									/>
									{t("passkeyOnly")}
								</label>
								<Button type="submit" disabled={busy}>
									{t("savePolicy")}
								</Button>
							</form>
							<form
								className="flex flex-wrap items-end gap-3"
								onSubmit={(event) => {
									event.preventDefault();
									const data = new FormData(event.currentTarget);
									void command({
										action: "capacity",
										capacity: Number(data.get("capacity")),
										operationKey: operationKey(),
									});
								}}
							>
								<label className="grid gap-2" htmlFor="seat-capacity">
									{t("seatCapacity")}
									<Input
										id="seat-capacity"
										type="number"
										name="capacity"
										min={snapshot.seats.occupied}
										max={100000}
										defaultValue={snapshot.seats.capacity}
										required
									/>
								</label>
								<Button type="submit" disabled={busy}>
									{t("saveCapacity")}
								</Button>
							</form>
						</section>
					)}
					{snapshot.membership.role === "owner" && (
						<section className="space-y-4 rounded-xl border border-border p-6">
							<h2 className="text-xl font-semibold">{t("transfer")}</h2>
							<p>{t("reauthenticate")}</p>
							<form
								className="flex flex-wrap items-end gap-3"
								onSubmit={(event) => {
									event.preventDefault();
									const data = new FormData(event.currentTarget);
									void command({
										action: "startTransfer",
										recipientMembershipId: String(data.get("membershipId")),
										outgoingRole: data.get("outgoingRole") as
											| "admin"
											| "member"
											| "billing"
											| "inactive",
										operationKey: operationKey(),
									});
								}}
							>
								<div className="grid min-w-0 max-w-full flex-1 basis-64 gap-2">
									<label htmlFor="transfer-recipient">{t("recipient")}</label>
									<select
										id="transfer-recipient"
										className="min-h-10 w-full min-w-0 max-w-full rounded border border-input p-2"
										name="membershipId"
										required
									>
										{snapshot.members
											.filter(
												(member) =>
													member.id !== snapshot.membership.id &&
													member.status === "active",
											)
											.map((member) => (
												<option key={member.id} value={member.id}>
													{member.email}
												</option>
											))}
									</select>
								</div>
								<div className="grid min-w-0 max-w-full flex-1 basis-64 gap-2">
									<label htmlFor="transfer-outgoing-role">
										{t("outgoingRole")}
									</label>
									<select
										id="transfer-outgoing-role"
										className="min-h-10 w-full min-w-0 max-w-full rounded border border-input p-2"
										name="outgoingRole"
										defaultValue="member"
									>
										<option value="admin">{t("admin")}</option>
										<option value="member">{t("member")}</option>
										<option value="billing">{t("billing")}</option>
										<option value="inactive">{t("leaveOrganization")}</option>
									</select>
								</div>
								<Button type="submit" disabled={busy}>
									{t("nominate")}
								</Button>
							</form>
						</section>
					)}
					<section className="space-y-4 rounded-xl border border-border p-6">
						<h2 className="text-xl font-semibold">{t("pending")}</h2>
						<ul className="space-y-3">
							{snapshot.transfers
								.filter((transfer) => transfer.status === "pending")
								.map((transfer) => (
									<li className="flex flex-wrap gap-4" key={transfer.id}>
										<span className="min-w-0 break-all">
											{snapshot.members.find(
												(member) => member.id === transfer.toMembershipId,
											)?.email ?? transfer.toMembershipId}
										</span>
										<span>
											{t("outgoingRole")}:{" "}
											{t(
												transfer.outgoingRole === "inactive"
													? "leaveOrganization"
													: transfer.outgoingRole,
											)}
										</span>
										{transfer.toMembershipId === snapshot.membership.id && (
											<Button
												disabled={busy}
												onClick={() =>
													void command({
														action: "acceptTransfer",
														transferId: transfer.id,
														operationKey: operationKey(),
													})
												}
											>
												{t("accept")}
											</Button>
										)}
										<Button
											disabled={busy}
											onClick={() =>
												void command({
													action: "cancelTransfer",
													transferId: transfer.id,
													operationKey: operationKey(),
												})
											}
										>
											{t("cancel")}
										</Button>
									</li>
								))}
						</ul>
					</section>
				</>
			) : (
				<Button
					disabled={busy}
					onClick={() =>
						void refresh().catch(() => setMessage(t("permission")))
					}
				>
					{t("fresh")}
				</Button>
			)}
		</main>
	);
}

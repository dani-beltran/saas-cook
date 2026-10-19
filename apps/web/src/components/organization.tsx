"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { createApiClient } from "@saas-cook/api/client";
import type {
	OrganizationCommand,
	OrganizationSnapshotDto,
} from "@saas-cook/api-contracts";
import {
	Button,
	Checkbox,
	Dialog,
	DialogContent,
	DialogDescription,
	DialogTitle,
	Input,
	NativeSelect,
	NativeSelectOption,
} from "@saas-cook/ui";
import { useLocale, useTranslations } from "next-intl";
import { useCallback, useEffect, useRef, useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { organizationDashboardCopy } from "../i18n/organization-dashboard";
import { DashboardShell } from "./dashboard-shell";
import "./organization-dashboard.css";

type CommandInput = OrganizationCommand extends infer Command
	? Command extends OrganizationCommand
		? Omit<Command, "operationKey">
		: never
	: never;
type Section = "members" | "invitations" | "teams" | "security" | "ownership";
type Summary = Pick<OrganizationSnapshotDto, "organization" | "membership">;
type Feedback = {
	scope: string;
	message: string;
	failed?: boolean;
	reauth?: boolean;
};
type Run = (scope: string, value: CommandInput) => Promise<boolean>;
type Confirm = (
	scope: string,
	value: CommandInput,
	description: string,
	title?: string,
) => void;
type Confirmation = {
	scope: string;
	value: CommandInput;
	description: string;
	title: string;
};

function useCopy() {
	const locale = useLocale();
	return {
		locale,
		t: useTranslations("Account"),
		copy: organizationDashboardCopy[locale === "es" ? "es" : "en"],
	};
}

function Notice({
	feedback,
	scope,
}: {
	feedback: Feedback | null;
	scope: string;
}) {
	const { copy, locale } = useCopy();
	if (!feedback || feedback.scope !== scope) return null;
	return (
		<div
			className={`dashboard-notice org-feedback${feedback.failed ? " org-feedback-error" : ""}`}
		>
			<p role="status" aria-live="polite">
				{feedback.message}
			</p>
			{feedback.reauth && (
				<>
					<p>{copy.verifyHint}</p>
					<a
						href={`/${locale}/account#security`}
						target="_blank"
						rel="noreferrer"
					>
						{copy.verifyAccount} ↗
					</a>
				</>
			)}
		</div>
	);
}

export function ConfirmDialog({
	value,
	busy,
	feedback,
	onCancel,
	onConfirm,
}: {
	value: Confirmation | null;
	busy: boolean;
	feedback: Feedback | null;
	onCancel: () => void;
	onConfirm: () => void;
}) {
	const { t, copy } = useCopy();
	return (
		<Dialog
			open={Boolean(value)}
			onOpenChange={(open) => {
				if (!open && !busy) onCancel();
			}}
		>
			<DialogContent
				className="org-dialog"
				showCloseButton={false}
				onInteractOutside={(event) => event.preventDefault()}
				onEscapeKeyDown={(event) => {
					if (busy) event.preventDefault();
				}}
			>
				{value && (
					<>
						<DialogTitle>{value.title}</DialogTitle>
						<DialogDescription className="dashboard-description">
							{value.description}
						</DialogDescription>
						<Notice feedback={feedback} scope={value.scope} />
						<div className="org-dialog-actions">
							<Button
								className="dashboard-secondary"
								disabled={busy}
								onClick={onCancel}
							>
								{t("cancel")}
							</Button>
							<Button disabled={busy} onClick={onConfirm}>
								{busy ? copy.working : copy.confirmChange}
							</Button>
						</div>
					</>
				)}
			</DialogContent>
		</Dialog>
	);
}

function InviteForm({ busy, run }: { busy: boolean; run: Run }) {
	const { t, copy } = useCopy();
	const schema = z.object({
		email: z.email(t("emailInvalid")),
		role: z.enum(["member", "admin", "billing"]),
	});
	const {
		register,
		handleSubmit,
		reset,
		formState: { errors },
	} = useForm<z.infer<typeof schema>>({
		resolver: zodResolver(schema),
		defaultValues: { email: "", role: "member" },
	});
	return (
		<form
			className="org-inline-form"
			noValidate
			aria-busy={busy}
			onSubmit={handleSubmit(async (value) => {
				if (await run("invitations", { action: "invite", ...value })) reset();
			})}
		>
			<div className="dashboard-field org-form-grow">
				<label htmlFor="invitation-email">{t("email")}</label>
				<Input
					id="invitation-email"
					type="email"
					autoComplete="off"
					disabled={busy}
					aria-invalid={Boolean(errors.email)}
					aria-describedby={errors.email ? "invitation-email-error" : undefined}
					{...register("email")}
				/>
				{errors.email && (
					<p
						className="org-field-error"
						role="alert"
						id="invitation-email-error"
					>
						{errors.email.message}
					</p>
				)}
			</div>
			<div className="dashboard-field">
				<label htmlFor="invitation-role">{t("role")}</label>
				<NativeSelect
					id="invitation-role"
					disabled={busy}
					{...register("role")}
				>
					<NativeSelectOption value="member">{t("member")}</NativeSelectOption>
					<NativeSelectOption value="admin">{t("admin")}</NativeSelectOption>
					<NativeSelectOption value="billing">
						{t("billing")}
					</NativeSelectOption>
				</NativeSelect>
			</div>
			<Button type="submit" disabled={busy}>
				{busy ? copy.working : t("invite")}
			</Button>
		</form>
	);
}

function CreateTeamForm({ busy, run }: { busy: boolean; run: Run }) {
	const { t, copy } = useCopy();
	const schema = z.object({
		name: z
			.string()
			.trim()
			.min(1, copy.teamNameInvalid)
			.max(80, copy.teamNameInvalid),
	});
	const {
		register,
		handleSubmit,
		reset,
		formState: { errors },
	} = useForm<z.infer<typeof schema>>({
		resolver: zodResolver(schema),
		defaultValues: { name: "" },
	});
	return (
		<form
			className="org-inline-form"
			noValidate
			aria-busy={busy}
			onSubmit={handleSubmit(async (value) => {
				if (await run("teams", { action: "createTeam", ...value })) reset();
			})}
		>
			<div className="dashboard-field org-form-grow">
				<label htmlFor="team-name">{t("team")}</label>
				<Input
					id="team-name"
					autoComplete="off"
					disabled={busy}
					aria-invalid={Boolean(errors.name)}
					aria-describedby={errors.name ? "team-name-error" : undefined}
					{...register("name")}
				/>
				{errors.name && (
					<p className="org-field-error" role="alert" id="team-name-error">
						{errors.name.message}
					</p>
				)}
			</div>
			<Button type="submit" disabled={busy}>
				{busy ? copy.working : t("createTeam")}
			</Button>
		</form>
	);
}

function CapacityForm({
	seats,
	busy,
	run,
}: {
	seats: OrganizationSnapshotDto["seats"];
	busy: boolean;
	run: Run;
}) {
	const { t, copy } = useCopy();
	const schema = z.object({
		capacity: z
			.number()
			.int(copy.capacityInvalid)
			.min(seats.occupied, copy.capacityInvalid)
			.max(100000, copy.capacityInvalid),
	});
	const {
		register,
		handleSubmit,
		reset,
		formState: { errors },
	} = useForm<z.infer<typeof schema>>({
		resolver: zodResolver(schema),
		defaultValues: { capacity: seats.capacity },
	});
	useEffect(() => {
		reset({ capacity: seats.capacity });
	}, [reset, seats.capacity]);
	return (
		<form
			className="org-inline-form"
			noValidate
			aria-busy={busy}
			onSubmit={handleSubmit(async (value) => {
				await run("capacity", { action: "capacity", ...value });
			})}
		>
			<div className="dashboard-field">
				<label htmlFor="seat-capacity">{t("seatCapacity")}</label>
				<Input
					id="seat-capacity"
					type="number"
					min={seats.occupied}
					max={100000}
					disabled={busy}
					aria-invalid={Boolean(errors.capacity)}
					aria-describedby={errors.capacity ? "seat-capacity-error" : undefined}
					{...register("capacity", { valueAsNumber: true })}
				/>
				{errors.capacity && (
					<p className="org-field-error" role="alert" id="seat-capacity-error">
						{errors.capacity.message}
					</p>
				)}
			</div>
			<Button type="submit" className="dashboard-secondary" disabled={busy}>
				{t("saveCapacity")}
			</Button>
		</form>
	);
}

export function MemberRow({
	member,
	currentId,
	busy,
	run,
	confirm,
}: {
	member: OrganizationSnapshotDto["members"][number];
	currentId: string;
	busy: boolean;
	run: Run;
	confirm: Confirm;
}) {
	const { t, copy } = useCopy();
	const [role, setRole] = useState(member.role);
	useEffect(() => setRole(member.role), [member.role]);
	return (
		<li className="org-member-row">
			<div className="org-member-identity">
				<span className="org-avatar" aria-hidden="true">
					{member.email.slice(0, 1).toUpperCase()}
				</span>
				<span className="org-email">
					{member.email}
					{member.id === currentId && (
						<span className="org-you">{copy.you}</span>
					)}
				</span>
			</div>
			<span className="org-role-label">{t(member.role)}</span>
			<span
				className={`dashboard-badge org-status-${member.status === "active" ? "active" : "inactive"}`}
			>
				{member.status === "active" ? copy.active : copy.inactive}
			</span>
			<details
				className="org-member-menu"
				onKeyDown={(event) => {
					if (event.key === "Escape") {
						event.currentTarget.open = false;
						event.currentTarget.querySelector("summary")?.focus();
					}
				}}
			>
				<summary aria-label={`${copy.manageMember}: ${member.email}`}>
					{copy.manage}
				</summary>
				<div className="org-member-menu-content">
					<form
						onSubmit={(event) => {
							event.preventDefault();
							confirm(
								"members",
								{
									action: "membership",
									membershipId: member.id,
									status: member.status === "active" ? "active" : "inactive",
									role,
									billable:
										role === member.role ? member.billable : role !== "billing",
								},
								copy.confirmRole,
								`${copy.saveRole}: ${member.email}`,
							);
						}}
					>
						<label htmlFor={`role-${member.id}`}>{t("role")}</label>
						<NativeSelect
							id={`role-${member.id}`}
							value={role}
							disabled={busy}
							onChange={(event) =>
								setRole(event.target.value as typeof member.role)
							}
						>
							{member.role === "owner" && (
								<NativeSelectOption value="owner">
									{t("owner")}
								</NativeSelectOption>
							)}
							<NativeSelectOption value="admin">
								{t("admin")}
							</NativeSelectOption>
							<NativeSelectOption value="member">
								{t("member")}
							</NativeSelectOption>
							<NativeSelectOption value="billing">
								{t("billing")}
							</NativeSelectOption>
						</NativeSelect>
						<Button
							type="submit"
							className="dashboard-secondary"
							disabled={busy || role === member.role}
						>
							{copy.saveRole}
						</Button>
					</form>
					<Button
						className={
							member.status === "active"
								? "dashboard-danger"
								: "dashboard-secondary"
						}
						disabled={busy}
						onClick={() => {
							const value = {
								action: "membership" as const,
								membershipId: member.id,
								role: member.role,
								billable: member.billable,
								status:
									member.status === "active"
										? ("inactive" as const)
										: ("active" as const),
							};
							if (member.status === "active")
								confirm(
									"members",
									value,
									copy.confirmDeactivate,
									`${t("suspend")}: ${member.email}`,
								);
							else void run("members", value);
						}}
					>
						{t(member.status === "active" ? "suspend" : "activate")}
					</Button>
				</div>
			</details>
		</li>
	);
}

export function TeamCard({
	team,
	snapshot,
	busy,
	run,
	confirm,
}: {
	team: OrganizationSnapshotDto["teams"][number];
	snapshot: OrganizationSnapshotDto;
	busy: boolean;
	run: Run;
	confirm: Confirm;
}) {
	const { t, copy } = useCopy();
	const [filter, setFilter] = useState("");
	const [selected, setSelected] = useState("");
	const members = snapshot.members.filter((member) =>
		team.membershipIds.includes(member.id),
	);
	const available = snapshot.members.filter(
		(member) =>
			member.status === "active" && !team.membershipIds.includes(member.id),
	);
	const filtered = available.filter((member) =>
		member.email.toLocaleLowerCase().includes(filter.toLocaleLowerCase()),
	);
	const selectedId = filtered.some((member) => member.id === selected)
		? selected
		: (filtered[0]?.id ?? "");
	return (
		<article
			className="org-team"
			aria-label={t("teamDetails", { name: team.name })}
		>
			<details>
				<summary className="org-team-summary">
					<h3>{team.name}</h3>
					<span className="dashboard-badge">{members.length}</span>
				</summary>
				<div className="org-team-body">
					{members.length ? (
						<ul className="org-team-members">
							{members.map((member) => (
								<li key={member.id}>
									<span className="org-email">{member.email}</span>
									<Button
										className="dashboard-secondary"
										disabled={busy}
										aria-label={t("removeTeamMemberNamed", {
											email: member.email,
											team: team.name,
										})}
										onClick={() =>
											confirm(
												"teams",
												{
													action: "removeTeamMember",
													teamId: team.id,
													membershipId: member.id,
												},
												copy.confirmTeamMember,
												t("removeTeamMember"),
											)
										}
									>
										{t("remove")}
									</Button>
								</li>
							))}
						</ul>
					) : (
						<p className="dashboard-description">{t("teamEmpty")}</p>
					)}
					{available.length ? (
						<form
							className="org-team-add"
							onSubmit={(event) => {
								event.preventDefault();
								if (selectedId)
									void run("teams", {
										action: "addTeamMember",
										teamId: team.id,
										membershipId: selectedId,
									});
							}}
						>
							<div className="dashboard-field">
								<label htmlFor={`team-filter-${team.id}`}>
									{copy.searchTeamMembers}
								</label>
								<Input
									id={`team-filter-${team.id}`}
									value={filter}
									onChange={(event) => setFilter(event.target.value)}
									disabled={busy}
									type="search"
								/>
							</div>
							<div className="org-inline-form">
								<div className="dashboard-field org-form-grow">
									<label htmlFor={`team-member-${team.id}`}>
										{t("membership")}
									</label>
									<NativeSelect
										id={`team-member-${team.id}`}
										value={selectedId}
										disabled={busy || !filtered.length}
										onChange={(event) => setSelected(event.target.value)}
									>
										{filtered.length ? (
											filtered.map((member) => (
												<NativeSelectOption key={member.id} value={member.id}>
													{member.email}
												</NativeSelectOption>
											))
										) : (
											<NativeSelectOption value="">
												{copy.noMatches}
											</NativeSelectOption>
										)}
									</NativeSelect>
								</div>
								<Button
									type="submit"
									className="dashboard-secondary"
									disabled={busy || !selectedId}
								>
									{t("addTeamMember")}
								</Button>
							</div>
						</form>
					) : (
						<p className="dashboard-description">{copy.allMembersAdded}</p>
					)}
					<div className="org-team-danger">
						<Button
							className="dashboard-danger"
							disabled={busy}
							aria-label={t("removeTeamNamed", { name: team.name })}
							onClick={() =>
								confirm(
									"teams",
									{ action: "removeTeam", teamId: team.id },
									copy.confirmTeamDelete,
									t("removeTeamNamed", { name: team.name }),
								)
							}
						>
							{t("removeTeam")}
						</Button>
					</div>
				</div>
			</details>
		</article>
	);
}

function SecurityPolicy({
	summary,
	editable,
	busy,
	confirm,
}: {
	summary: Summary;
	editable: boolean;
	busy: boolean;
	confirm: Confirm;
}) {
	const { t, copy, locale } = useCopy();
	const policy = summary.organization.securityPolicy;
	return (
		<>
			{editable ? (
				<>
					<p className="dashboard-description">{t("policyAssurance")}</p>
					<a
						className="org-inline-link"
						href={`/${locale}/account#security`}
						target="_blank"
						rel="noreferrer"
					>
						{copy.verifyAccount} ↗
					</a>
					<form
						className="org-policy-form"
						onSubmit={(event) => {
							event.preventDefault();
							const data = new FormData(event.currentTarget);
							confirm(
								"security",
								{
									action: "securityPolicy",
									requireMfa: data.has("requireMfa"),
									acceptPasskeyMfa: data.has("acceptPasskeyMfa"),
									requiredAuthMethod: data.has("passkeyOnly")
										? "passkey"
										: null,
								},
								copy.confirmPolicy,
								t("savePolicy"),
							);
						}}
					>
						<label className="org-policy-row" htmlFor="policy-requireMfa">
							<span>{t("requireMfa")}</span>
							<Checkbox
								id="policy-requireMfa"
								name="requireMfa"
								disabled={busy}
								defaultChecked={policy?.requireMfa}
							/>
						</label>
						<label className="org-policy-row" htmlFor="policy-acceptPasskeyMfa">
							<span>{t("acceptPasskeyMfa")}</span>
							<Checkbox
								id="policy-acceptPasskeyMfa"
								name="acceptPasskeyMfa"
								disabled={busy}
								defaultChecked={policy?.acceptPasskeyMfa}
							/>
						</label>
						<label className="org-policy-row" htmlFor="policy-passkeyOnly">
							<span>{t("passkeyOnly")}</span>
							<Checkbox
								id="policy-passkeyOnly"
								name="passkeyOnly"
								disabled={busy}
								defaultChecked={policy?.requiredAuthMethod === "passkey"}
							/>
						</label>
						<Button type="submit" disabled={busy}>
							{t("savePolicy")}
						</Button>
					</form>
				</>
			) : (
				<>
					<p className="dashboard-description">{copy.ownerOnly}</p>
					<dl className="org-policy-readonly">
						<div>
							<dt>{t("requireMfa")}</dt>
							<dd className="dashboard-badge">
								{policy?.requireMfa ? copy.policyEnabled : copy.policyOptional}
							</dd>
						</div>
						<div>
							<dt>{t("acceptPasskeyMfa")}</dt>
							<dd className="dashboard-badge">
								{policy?.acceptPasskeyMfa
									? copy.policyAccepted
									: copy.policyNotAccepted}
							</dd>
						</div>
						<div>
							<dt>{t("passkeyOnly")}</dt>
							<dd className="dashboard-badge">
								{policy?.requiredAuthMethod === "passkey"
									? copy.policyEnabled
									: copy.policyOptional}
							</dd>
						</div>
					</dl>
				</>
			)}
		</>
	);
}

export function Organization({ organizationId }: { organizationId: string }) {
	const { locale, t, copy } = useCopy();
	const projects = useTranslations("Projects");
	const [snapshot, setSnapshot] = useState<OrganizationSnapshotDto | null>(
		null,
	);
	const [summary, setSummary] = useState<Summary | null>(null);
	const [loading, setLoading] = useState(true);
	const [loadFailed, setLoadFailed] = useState(false);
	const [feedback, setFeedback] = useState<Feedback | null>(null);
	const [busyScope, setBusyScope] = useState<string | null>(null);
	const [section, setSection] = useState<Section>("members");
	const [memberFilter, setMemberFilter] = useState("");
	const [teamFilter, setTeamFilter] = useState("");
	const [confirmation, setConfirmation] = useState<Confirmation | null>(null);
	const [acceptance, setAcceptance] = useState<{
		kind: "invite" | "transfer";
		value: string;
	} | null>(null);
	const generation = useRef(0);
	const mounted = useRef(false);
	const busyRef = useRef(false);
	const operationKeys = useRef(new Map<string, string>());
	const busy = busyScope !== null;

	const refresh = useCallback(async () => {
		const request = ++generation.current;
		setLoading(true);
		setLoadFailed(false);
		try {
			const api = createApiClient(`${window.location.origin}/api/rpc`);
			const own = await api.organizations.summary({ organizationId });
			const current = ["owner", "admin"].includes(own.membership.role)
				? await api.organizations.get({ organizationId })
				: null;
			if (mounted.current && request === generation.current) {
				setSummary(own);
				setSnapshot(current);
			}
			return true;
		} catch {
			if (mounted.current && request === generation.current) {
				setSummary(null);
				setSnapshot(null);
				setLoadFailed(true);
			}
			return false;
		} finally {
			if (mounted.current && request === generation.current) setLoading(false);
		}
	}, [organizationId]);
	useEffect(() => {
		mounted.current = true;
		const query = new URLSearchParams(window.location.search);
		const invite = query.get("invite");
		const transfer = query.get("transfer");
		if (invite || transfer) {
			setAcceptance({
				kind: invite ? "invite" : "transfer",
				value: invite ?? transfer ?? "",
			});
			query.delete("invite");
			query.delete("transfer");
			const remaining = query.toString();
			window.history.replaceState(
				null,
				"",
				`${window.location.pathname}${remaining ? `?${remaining}` : ""}${window.location.hash}`,
			);
		}
		function readSection() {
			const hash = window.location.hash.slice(1);
			if (
				["members", "invitations", "teams", "security", "ownership"].includes(
					hash,
				)
			)
				setSection(hash as Section);
		}
		readSection();
		window.addEventListener("hashchange", readSection);
		void refresh();
		return () => {
			mounted.current = false;
			generation.current++;
			window.removeEventListener("hashchange", readSection);
		};
	}, [refresh]);

	const run: Run = async (scope, value) => {
		if (busyRef.current) return false;
		busyRef.current = true;
		setBusyScope(scope);
		setFeedback(null);
		// Another action in the same section must not replace a pending retry key.
		const submission = `${scope}:${JSON.stringify(value)}`;
		let operationKey = operationKeys.current.get(submission);
		if (!operationKey) {
			operationKey = crypto.randomUUID();
			operationKeys.current.set(submission, operationKey);
		}
		try {
			await createApiClient(
				`${window.location.origin}/api/rpc`,
			).organizations.command({
				organizationId,
				command: { ...value, operationKey },
			});
			operationKeys.current.delete(submission);
			if (!mounted.current) return true;
			if (
				value.action === "acceptInvitation" ||
				value.action === "acceptTransfer"
			) {
				setAcceptance(null);
				if (value.action === "acceptTransfer") setSection("ownership");
			}
			setConfirmation(null);
			const refreshed = await refresh();
			if (mounted.current)
				setFeedback({
					scope,
					message: refreshed ? t("saved") : copy.refreshFailed,
				});
			return true;
		} catch (error) {
			if (!mounted.current) return false;
			const failure = error as { code?: string; message?: string };
			const reauth =
				failure.code === "UNAUTHORIZED" || failure.message === "ASSURANCE";
			const message =
				failure.message === "CAPACITY"
					? t("capacityDenied")
					: failure.message === "LAST_OWNER"
						? t("lastOwnerDenied")
						: failure.message === "EXPIRED"
							? copy.expiredLink
							: reauth
								? t("reauthenticate")
								: failure.code === "CONFLICT"
									? t("conflict")
									: failure.code === "FORBIDDEN"
										? t("permission")
										: copy.unavailable;
			setFeedback({
				scope,
				message,
				failed: true,
				reauth:
					reauth ||
					([
						"securityPolicy",
						"startTransfer",
						"acceptTransfer",
						"acceptInvitation",
					].includes(value.action) &&
						failure.code === "FORBIDDEN"),
			});
			return false;
		} finally {
			busyRef.current = false;
			if (mounted.current) setBusyScope(null);
		}
	};
	const confirm: Confirm = (
		scope,
		value,
		description,
		title = copy.confirmChange,
	) => {
		setFeedback(null);
		setConfirmation({ scope, value, description, title });
	};
	const isOwner = summary?.membership.role === "owner";
	const tabs: { id: Section; label: string }[] = [
		{ id: "members", label: t("members") },
		{ id: "invitations", label: t("invitations") },
		{ id: "teams", label: t("teams") },
		{ id: "security", label: t("security") },
		{ id: "ownership", label: copy.ownership },
	];
	const selectSection = (next: Section) => {
		setSection(next);
		window.history.replaceState(
			null,
			"",
			`${window.location.pathname}${window.location.search}#${next}`,
		);
	};
	const filteredMembers =
		snapshot?.members.filter((member) =>
			member.email
				.toLocaleLowerCase()
				.includes(memberFilter.toLocaleLowerCase()),
		) ?? [];
	const filteredTeams =
		snapshot?.teams.filter((team) =>
			team.name.toLocaleLowerCase().includes(teamFilter.toLocaleLowerCase()),
		) ?? [];
	const pendingTransfers =
		snapshot?.transfers.filter((transfer) => transfer.status === "pending") ??
		[];
	const recipients =
		snapshot?.members.filter(
			(member) =>
				member.id !== snapshot.membership.id && member.status === "active",
		) ?? [];
	const notice = (scope: string) => (
		<Notice feedback={confirmation ? null : feedback} scope={scope} />
	);
	const statusLabel = (status: string) =>
		({
			active: copy.active,
			inactive: copy.inactive,
			pending: copy.pending,
			accepted: copy.accepted,
			canceled: copy.canceled,
			expired: copy.expired,
		})[status] ?? copy.unknownStatus;
	const date = (value: string) =>
		new Intl.DateTimeFormat(locale, { dateStyle: "medium" }).format(
			new Date(value),
		);

	return (
		<DashboardShell
			section="organization"
			organizationId={organizationId}
			onLocaleChange={
				acceptance
					? (nextLocale) => {
							const url = new URL(window.location.href);
							url.pathname = url.pathname.replace(
								/^\/(en|es)(?=\/|$)/,
								`/${nextLocale}`,
							);
							url.searchParams.set(acceptance.kind, acceptance.value);
							window.location.assign(url.href);
						}
					: undefined
			}
		>
			<div className="org-page">
				<header className="dashboard-page-header">
					<div>
						<p className="dashboard-eyebrow">{copy.eyebrow}</p>
						<h1>{summary?.organization.name ?? t("organizations")}</h1>
						<p className="dashboard-description">{copy.description}</p>
					</div>
					<div className="org-header-actions">
						{summary && (
							<Button
								className="dashboard-secondary"
								disabled={busy || loading}
								onClick={() => void refresh()}
							>
								{loading ? t("loading") : t("fresh")}
							</Button>
						)}
						<a
							className="org-project-link"
							href={`/${locale}/organizations/${organizationId}/projects`}
						>
							{projects("openProjects")} <span aria-hidden="true">↗</span>
						</a>
					</div>
				</header>
				{acceptance && (
					<section
						className="org-acceptance"
						aria-labelledby="acceptance-heading"
					>
						<h2 id="acceptance-heading">
							{t(
								acceptance.kind === "invite"
									? "inviteReceived"
									: "transferReceived",
							)}
						</h2>
						<p className="dashboard-description">{copy.acceptanceNote}</p>
						{notice("acceptance")}
						<div className="org-inline-actions">
							<Button
								disabled={busy}
								onClick={() => {
									if (acceptance.kind === "invite")
										void run("acceptance", {
											action: "acceptInvitation",
											token: acceptance.value,
										});
									else
										confirm(
											"acceptance",
											{
												action: "acceptTransfer",
												transferId: acceptance.value,
											},
											copy.confirmAcceptTransfer,
											t("transferReceived"),
										);
								}}
							>
								{busyScope === "acceptance" ? copy.working : t("accept")}
							</Button>
							<a
								href={`/${locale}/account#security`}
								target="_blank"
								rel="noreferrer"
							>
								{copy.verifyAccount} ↗
							</a>
						</div>
					</section>
				)}
				{!summary && loading && (
					<p className="dashboard-empty" role="status">
						{copy.loading}
					</p>
				)}
				{!confirmation &&
					feedback &&
					!acceptance &&
					(feedback.scope === "acceptance" || !snapshot) && (
						<Notice feedback={feedback} scope={feedback.scope} />
					)}
				{loadFailed && !acceptance && (
					<div className="dashboard-notice">
						<p role="status">{copy.loadFailed}</p>
						<div className="org-inline-actions">
							<Button
								className="dashboard-secondary"
								disabled={busy || loading}
								onClick={() => void refresh()}
							>
								{copy.retry}
							</Button>
							<a href={`/${locale}/account`}>{t("back")}</a>
						</div>
					</div>
				)}
				{summary && !snapshot && (
					<>
						<section
							className="dashboard-section"
							aria-labelledby="membership-heading"
						>
							<div className="dashboard-section-heading">
								<h2 id="membership-heading">{copy.memberOverview}</h2>
								<p className="dashboard-description">
									{copy.memberDescription}
								</p>
							</div>
							<dl className="org-policy-readonly">
								<div>
									<dt>{t("email")}</dt>
									<dd className="org-email">{summary.membership.email}</dd>
								</div>
								<div>
									<dt>{t("role")}</dt>
									<dd className="dashboard-badge">
										{t(summary.membership.role)}
									</dd>
								</div>
								<div>
									<dt>{t("status")}</dt>
									<dd className="dashboard-badge org-status-active">
										{statusLabel(summary.membership.status)}
									</dd>
								</div>
							</dl>
							<p className="dashboard-description">{copy.memberPrivacy}</p>
						</section>
						<section
							className="dashboard-section"
							aria-labelledby="member-security-heading"
						>
							<div className="dashboard-section-heading">
								<h2 id="member-security-heading">{t("security")}</h2>
							</div>
							<SecurityPolicy
								summary={summary}
								editable={false}
								busy={busy}
								confirm={confirm}
							/>
						</section>
					</>
				)}
				{snapshot && (
					<>
						<div className="org-tab-bar">
							<div
								className="dashboard-subnav org-tabs"
								role="tablist"
								aria-label={copy.navigation}
							>
								{tabs.map((tab, index) => (
									<Button
										variant="ghost"
										size="plain"
										type="button"
										role="tab"
										key={tab.id}
										id={`org-tab-${tab.id}`}
										aria-controls={`org-panel-${tab.id}`}
										aria-selected={section === tab.id}
										tabIndex={section === tab.id ? 0 : -1}
										onClick={() => selectSection(tab.id)}
										onKeyDown={(event) => {
											let next = index;
											if (event.key === "ArrowRight")
												next = (index + 1) % tabs.length;
											else if (event.key === "ArrowLeft")
												next = (index + tabs.length - 1) % tabs.length;
											else if (event.key === "Home") next = 0;
											else if (event.key === "End") next = tabs.length - 1;
											else return;
											event.preventDefault();
											const target = tabs[next];
											if (target) {
												selectSection(target.id);
												document
													.getElementById(`org-tab-${target.id}`)
													?.focus();
											}
										}}
									>
										{tab.label}
									</Button>
								))}
							</div>
						</div>
						<section
							className="org-panel"
							id="org-panel-members"
							role="tabpanel"
							aria-labelledby="org-tab-members"
							hidden={section !== "members"}
						>
							<div className="dashboard-section-heading">
								<h2>{t("members")}</h2>
								<p className="dashboard-description">
									{copy.membersDescription}
								</p>
							</div>
							<div className="org-seats">
								<div>
									<span>{copy.seatUsage}</span>
									<strong>
										{snapshot.seats.occupied}
										<span> / {snapshot.seats.capacity}</span>
									</strong>
									<p className="dashboard-description">{copy.seatHint}</p>
								</div>
								<progress
									aria-label={copy.seatUsage}
									value={snapshot.seats.occupied}
									max={Math.max(1, snapshot.seats.capacity)}
								/>
							</div>
							{isOwner && (
								<details className="org-capacity">
									<summary>{copy.capacitySettings}</summary>
									<CapacityForm seats={snapshot.seats} busy={busy} run={run} />
									{notice("capacity")}
								</details>
							)}
							<div className="dashboard-field org-filter">
								<label htmlFor="member-filter">{copy.searchMembers}</label>
								<Input
									id="member-filter"
									type="search"
									value={memberFilter}
									onChange={(event) => setMemberFilter(event.target.value)}
								/>
							</div>
							{notice("members")}
							{filteredMembers.length ? (
								<ul className="org-members">
									{filteredMembers.map((member) => (
										<MemberRow
											key={member.id}
											member={member}
											currentId={snapshot.membership.id}
											busy={busy}
											run={run}
											confirm={confirm}
										/>
									))}
								</ul>
							) : (
								<p className="dashboard-empty">{copy.noMatches}</p>
							)}
						</section>
						<section
							className="org-panel"
							id="org-panel-invitations"
							role="tabpanel"
							aria-labelledby="org-tab-invitations"
							hidden={section !== "invitations"}
						>
							<div className="dashboard-section-heading">
								<h2>{t("invitations")}</h2>
								<p className="dashboard-description">
									{copy.invitationsDescription}
								</p>
							</div>
							<InviteForm busy={busy} run={run} />
							{notice("invitations")}
							<p className="org-list-caption">{copy.loadedInvitations}</p>
							{snapshot.invitations.length ? (
								<ul className="org-invitations">
									{snapshot.invitations.map((invite) => (
										<li className="org-invitation" key={invite.id}>
											<div>
												<p className="org-email">{invite.email}</p>
												<p className="dashboard-description">
													{t(invite.role)} · {copy.expires}{" "}
													{date(invite.expiresAt)}
												</p>
											</div>
											<span className="dashboard-badge">
												{statusLabel(invite.status)}
											</span>
											{invite.status === "pending" && (
												<Button
													className="dashboard-secondary"
													disabled={busy}
													onClick={() =>
														confirm(
															"invitations",
															{
																action: "cancelInvitation",
																invitationId: invite.id,
															},
															copy.confirmInvitation,
															`${t("cancel")}: ${invite.email}`,
														)
													}
												>
													{t("cancel")}
												</Button>
											)}
										</li>
									))}
								</ul>
							) : (
								<p className="dashboard-empty">{copy.noInvitations}</p>
							)}
						</section>
						<section
							className="org-panel"
							id="org-panel-teams"
							role="tabpanel"
							aria-labelledby="org-tab-teams"
							hidden={section !== "teams"}
						>
							<div className="dashboard-section-heading">
								<h2>{t("teams")}</h2>
								<p className="dashboard-description">{copy.teamsDescription}</p>
							</div>
							<CreateTeamForm busy={busy} run={run} />
							{notice("teams")}
							{snapshot.teams.length > 0 && (
								<div className="dashboard-field org-filter">
									<label htmlFor="team-filter">{copy.searchTeams}</label>
									<Input
										id="team-filter"
										type="search"
										value={teamFilter}
										onChange={(event) => setTeamFilter(event.target.value)}
									/>
								</div>
							)}
							<p className="org-list-caption">{copy.loadedTeams}</p>
							{filteredTeams.map((team) => (
								<TeamCard
									key={team.id}
									team={team}
									snapshot={snapshot}
									busy={busy}
									run={run}
									confirm={confirm}
								/>
							))}
							{!filteredTeams.length && (
								<p className="dashboard-empty">
									{snapshot.teams.length ? copy.noMatches : copy.noTeams}
								</p>
							)}
						</section>
						<section
							className="org-panel"
							id="org-panel-security"
							role="tabpanel"
							aria-labelledby="org-tab-security"
							hidden={section !== "security"}
						>
							<div className="dashboard-section-heading">
								<h2>{t("security")}</h2>
								<p className="dashboard-description">
									{copy.securityDescription}
								</p>
							</div>
							{notice("security")}
							<SecurityPolicy
								key={JSON.stringify(snapshot.organization.securityPolicy)}
								summary={snapshot}
								editable={isOwner}
								busy={busy}
								confirm={confirm}
							/>
						</section>
						<section
							className="org-panel"
							id="org-panel-ownership"
							role="tabpanel"
							aria-labelledby="org-tab-ownership"
							hidden={section !== "ownership"}
						>
							<div className="dashboard-section-heading">
								<h2>{t("transfer")}</h2>
								<p className="dashboard-description">
									{copy.ownershipDescription}
								</p>
							</div>
							{notice("ownership")}
							{isOwner &&
								(recipients.length ? (
									<form
										className="org-transfer-form"
										onSubmit={(event) => {
											event.preventDefault();
											const data = new FormData(event.currentTarget);
											confirm(
												"ownership",
												{
													action: "startTransfer",
													recipientMembershipId: String(
														data.get("membershipId"),
													),
													outgoingRole: data.get("outgoingRole") as
														| "admin"
														| "member"
														| "billing"
														| "inactive",
												},
												copy.confirmTransfer,
												t("nominate"),
											);
										}}
									>
										<div className="dashboard-field">
											<label htmlFor="transfer-recipient">
												{t("recipient")}
											</label>
											<NativeSelect
												id="transfer-recipient"
												name="membershipId"
												disabled={busy}
												required
											>
												{recipients.map((member) => (
													<NativeSelectOption key={member.id} value={member.id}>
														{member.email}
													</NativeSelectOption>
												))}
											</NativeSelect>
										</div>
										<div className="dashboard-field">
											<label htmlFor="transfer-outgoing-role">
												{t("outgoingRole")}
											</label>
											<NativeSelect
												id="transfer-outgoing-role"
												name="outgoingRole"
												defaultValue="member"
												disabled={busy}
											>
												<NativeSelectOption value="admin">
													{t("admin")}
												</NativeSelectOption>
												<NativeSelectOption value="member">
													{t("member")}
												</NativeSelectOption>
												<NativeSelectOption value="billing">
													{t("billing")}
												</NativeSelectOption>
												<NativeSelectOption value="inactive">
													{t("leaveOrganization")}
												</NativeSelectOption>
											</NativeSelect>
										</div>
										<p className="dashboard-description">{copy.transferNote}</p>
										<Button
											type="submit"
											className="dashboard-secondary"
											disabled={busy}
										>
											{t("nominate")}
										</Button>
									</form>
								) : (
									<p className="dashboard-empty">{copy.noRecipients}</p>
								))}
							<div className="org-pending-transfers">
								<h3>{t("pending")}</h3>
								{pendingTransfers.length ? (
									<ul>
										{pendingTransfers.map((transfer) => (
											<li key={transfer.id}>
												<div>
													<p className="org-email">
														{snapshot.members.find(
															(member) => member.id === transfer.toMembershipId,
														)?.email ?? copy.unknownStatus}
													</p>
													<p className="dashboard-description">
														{t("outgoingRole")}:{" "}
														{t(
															transfer.outgoingRole === "inactive"
																? "leaveOrganization"
																: transfer.outgoingRole,
														)}
													</p>
													<p className="dashboard-description">
														{copy.expires} {date(transfer.expiresAt)}
													</p>
												</div>
												<div className="org-inline-actions">
													{transfer.toMembershipId ===
														snapshot.membership.id && (
														<Button
															disabled={busy}
															onClick={() =>
																confirm(
																	"ownership",
																	{
																		action: "acceptTransfer",
																		transferId: transfer.id,
																	},
																	copy.confirmAcceptTransfer,
																	t("accept"),
																)
															}
														>
															{t("accept")}
														</Button>
													)}
													{isOwner &&
														transfer.fromMembershipId ===
															snapshot.membership.id && (
															<Button
																className="dashboard-secondary"
																disabled={busy}
																onClick={() =>
																	confirm(
																		"ownership",
																		{
																			action: "cancelTransfer",
																			transferId: transfer.id,
																		},
																		copy.confirmCancelTransfer,
																		t("cancel"),
																	)
																}
															>
																{t("cancel")}
															</Button>
														)}
												</div>
											</li>
										))}
									</ul>
								) : (
									<p className="dashboard-description">{copy.noTransfers}</p>
								)}
							</div>
						</section>
					</>
				)}
				<ConfirmDialog
					value={confirmation}
					busy={busy}
					feedback={feedback}
					onCancel={() => setConfirmation(null)}
					onConfirm={() => {
						if (confirmation) void run(confirmation.scope, confirmation.value);
					}}
				/>
			</div>
		</DashboardShell>
	);
}

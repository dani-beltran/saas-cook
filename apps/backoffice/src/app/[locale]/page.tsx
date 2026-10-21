"use client";
import { passkeyClient } from "@better-auth/passkey/client";
import { zodResolver } from "@hookform/resolvers/zod";
import {
	type OrganizationLookupInput,
	organizationLookupInput,
	organizationLookupOutput,
} from "@saas-cook/backoffice-contracts";
import { Button, Input } from "@saas-cook/ui";
import { createAuthClient } from "better-auth/react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { useForm } from "react-hook-form";

const auth = createAuthClient({ plugins: [passkeyClient()] });
/** Minimal private staff journey; API enforcement remains authoritative for every lookup. */
export default function Page() {
	const t = useTranslations("Backoffice"),
		[invitation, setInvitation] = useState(""),
		[busy, setBusy] = useState(false),
		[status, setStatus] = useState("empty"),
		[result, setResult] = useState<ReturnType<
			typeof organizationLookupOutput.parse
		> | null>(null);
	const form = useForm<OrganizationLookupInput>({
		resolver: zodResolver(organizationLookupInput),
		defaultValues: { organizationId: "", caseReference: "" },
	});
	async function run(action: () => Promise<void>) {
		setBusy(true);
		setResult(null);
		setStatus("working");
		try {
			await action();
		} catch {
			setStatus("denied");
		} finally {
			setBusy(false);
		}
	}
	return (
		<main>
			<h1>{t("title")}</h1>
			<p>{t("intro")}</p>
			<nav>
				<a href="/en">English</a> · <a href="/es">Español</a>
			</nav>
			<section aria-label={t("signIn")}>
				<Button
					type="button"
					disabled={busy}
					onClick={() =>
						run(async () => {
							const r = await auth.signIn.passkey();
							if (r?.error) throw new Error();
							setStatus("ready");
						})
					}
				>
					{t("signIn")}
				</Button>
				<label htmlFor="invitation">
					{t("invitation")}
					<Input
						id="invitation"
						disabled={busy}
						type="password"
						autoComplete="off"
						value={invitation}
						onChange={(e) => setInvitation(e.target.value)}
					/>
				</label>
				<Button
					type="button"
					disabled={busy || !invitation}
					onClick={() =>
						run(async () => {
							const enrollment = createAuthClient({
								plugins: [passkeyClient()],
								fetchOptions: {
									headers: { "x-backoffice-invitation": invitation },
								},
							});
							const r = await enrollment.passkey.addPasskey();
							if (r?.error) throw new Error();
							setInvitation("");
							setStatus("enrolled");
						})
					}
				>
					{t("enroll")}
				</Button>
				<Button
					type="button"
					disabled={busy}
					onClick={() =>
						run(async () => {
							const response = await auth.signOut();
							if (response.error) throw new Error();
							setStatus("empty");
						})
					}
				>
					{t("signOut")}
				</Button>
			</section>
			<form
				onSubmit={form.handleSubmit(
					async (values) => {
						await run(async () => {
							const r = await fetch("/api/organizations/lookup", {
								method: "POST",
								headers: { "content-type": "application/json" },
								body: JSON.stringify(values),
							});
							if (!r.ok) throw new Error();
							setResult(organizationLookupOutput.parse(await r.json()));
							setStatus("ready");
						});
					},
					() => {
						setResult(null);
						setStatus("invalid");
					},
				)}
			>
				<label htmlFor="organization">
					{t("organization")}
					<Input
						id="organization"
						disabled={busy}
						required
						{...form.register("organizationId")}
						aria-invalid={!!form.formState.errors.organizationId}
					/>
				</label>
				<label htmlFor="case">
					{t("case")}
					<Input
						id="case"
						disabled={busy}
						required
						maxLength={80}
						{...form.register("caseReference")}
						aria-invalid={!!form.formState.errors.caseReference}
					/>
				</label>
				<Button type="submit" disabled={busy}>
					{t("lookup")}
				</Button>
			</form>
			<p role="status" aria-live="polite">
				{t(status)}
			</p>
			{result && (
				<section>
					<h2>{result.name}</h2>
					<dl>
						<dt>ID</dt>
						<dd>{result.id}</dd>
						<dt>{t("lifecycle")}</dt>
						<dd>{result.lifecycle}</dd>
						<dt>{t("timestamp")}</dt>
						<dd>{result.sourceTimestamp}</dd>
						<dt>{t("audit")}</dt>
						<dd>{result.auditReference}</dd>
					</dl>
					<p>
						{t("seats", {
							occupied: result.seats.occupied,
							capacity: result.seats.capacity ?? t("unlimited"),
						})}
					</p>
				</section>
			)}
		</main>
	);
}

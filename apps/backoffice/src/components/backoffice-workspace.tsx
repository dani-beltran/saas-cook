"use client";
import { passkeyClient } from "@better-auth/passkey/client";
import { zodResolver } from "@hookform/resolvers/zod";
import {
	type OrganizationLookupInput,
	organizationLookupInput,
	organizationLookupOutput,
} from "@saas-cook/backoffice-contracts";
import { createAuthClient } from "better-auth/react";
import { useRouter } from "next/navigation";
import { useLocale } from "next-intl";
import { useCallback, useEffect, useRef, useState } from "react";
import { useForm } from "react-hook-form";
import { BackofficeView } from "./backoffice-view";
import { OrganizationDirectory } from "./organization-directory";

const auth = createAuthClient({ plugins: [passkeyClient()] });
/**
 * Runs staff ceremonies and scoped lookup for the selected localized page.
 * The page prop selects organization tools or staff session controls; defaults to
 * organizations. Returns a session-gated view; server services enforce authority.
 */
export function BackofficeWorkspace({
	page = "organizations",
	organizationId,
}: {
	page?: "organizations" | "staff-access" | "organization-detail";
	organizationId?: string;
}) {
	const router = useRouter();
	const locale = useLocale();
	const [invitation, setInvitation] = useState(""),
		[busy, setBusy] = useState(false),
		[status, setStatus] = useState<
			"empty" | "working" | "ready" | "enrolled" | "denied" | "invalid"
		>("empty"),
		[result, setResult] = useState<ReturnType<
			typeof organizationLookupOutput.parse
		> | null>(null);
	const [authenticated, setAuthenticated] = useState(false);
	const [checking, setChecking] = useState(true);
	const sessionCheck = useRef(0);
	const refreshSession = useCallback(async () => {
		const version = ++sessionCheck.current;
		let valid = false;
		try {
			valid = (
				await fetch("/api/session", { method: "POST", cache: "no-store" })
			).ok;
		} catch {}
		if (version === sessionCheck.current) {
			setAuthenticated(valid);
			setChecking(false);
			if (!valid) {
				setResult(null);
				setInvitation("");
			}
		}
		return valid;
	}, []);
	useEffect(() => {
		void refreshSession();
		const onFocus = () => {
			void refreshSession();
		};
		window.addEventListener("focus", onFocus);
		return () => {
			++sessionCheck.current;
			window.removeEventListener("focus", onFocus);
		};
	}, [refreshSession]);
	const [directoryRevision, setDirectoryRevision] = useState(0);
	const form = useForm<OrganizationLookupInput>({
		resolver: zodResolver(organizationLookupInput),
		defaultValues: { organizationId: "", caseReference: "" },
	});
	async function run(action: () => Promise<void>, resetDirectory = true) {
		if (resetDirectory) setDirectoryRevision((value) => value + 1);
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
	useEffect(() => {
		if (!authenticated) {
			setBusy(false);
			return;
		}
		if (page !== "organization-detail" || !organizationId) return;
		const controller = new AbortController();
		setResult(null);
		form.reset({ organizationId, caseReference: "" });
		let stored: string | null = null;
		try {
			stored = sessionStorage.getItem(`bo-detail-case:${organizationId}`);
		} catch {}
		const input = organizationLookupInput.safeParse({
			organizationId,
			caseReference: stored,
		});
		if (!input.success) return;
		form.reset(input.data);
		setBusy(true);
		setStatus("working");
		void (async () => {
			try {
				const response = await fetch("/api/organizations/lookup", {
					method: "POST",
					cache: "no-store",
					headers: { "content-type": "application/json" },
					body: JSON.stringify(input.data),
					signal: controller.signal,
				});
				if (!response.ok) {
					await refreshSession();
					throw new Error();
				}
				const value = organizationLookupOutput.parse(await response.json());
				if (!controller.signal.aborted) {
					setResult(value);
					setStatus("ready");
					requestAnimationFrame(() =>
						document.getElementById("overview-title")?.focus(),
					);
				}
			} catch {
				if (!controller.signal.aborted) setStatus("denied");
			} finally {
				if (!controller.signal.aborted) setBusy(false);
			}
		})();
		return () => controller.abort();
	}, [authenticated, page, organizationId, form, refreshSession]);
	async function lookup(values: OrganizationLookupInput) {
		const input = organizationLookupInput.parse(values);
		if (page !== "organization-detail") {
			try {
				sessionStorage.setItem(
					`bo-detail-case:${input.organizationId}`,
					input.caseReference,
				);
			} catch {}
			router.push(`/${locale}/organizations/${input.organizationId}`);
			return;
		}
		try {
			sessionStorage.setItem(
				`bo-detail-case:${input.organizationId}`,
				input.caseReference,
			);
		} catch {}

		await run(async () => {
			form.reset(values);
			const response = await fetch("/api/organizations/lookup", {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify(values),
			});
			if (!response.ok) {
				await refreshSession();
				throw new Error();
			}
			setResult(organizationLookupOutput.parse(await response.json()));
			setStatus("ready");
		}, false);
		requestAnimationFrame(() =>
			document.getElementById("overview-title")?.focus(),
		);
	}
	return (
		<BackofficeView
			page={page}
			authenticated={authenticated}
			checking={checking}
			directory={
				<OrganizationDirectory
					key={directoryRevision}
					disabled={busy}
					onLookup={lookup}
					onUnavailable={() => {
						void refreshSession();
					}}
					onActivity={() => {
						setStatus("empty");
						setResult(null);
					}}
				/>
			}
			busy={busy || checking}
			status={status}
			invitation={invitation}
			result={result}
			form={form}
			onInvitationChange={setInvitation}
			onSignIn={() =>
				void run(async () => {
					const response = await auth.signIn.passkey();
					if (response?.error || !(await refreshSession())) throw new Error();
					setStatus("ready");
				})
			}
			onEnroll={() =>
				void run(async () => {
					const enrollment = createAuthClient({
						plugins: [passkeyClient()],
						fetchOptions: {
							headers: { "x-backoffice-invitation": invitation },
						},
					});
					const response = await enrollment.passkey.addPasskey();
					if (response?.error) throw new Error();
					setInvitation("");
					setStatus("enrolled");
				})
			}
			onSignOut={() =>
				void run(async () => {
					++sessionCheck.current;
					setAuthenticated(false);
					const response = await auth.signOut();
					if (response.error) throw new Error();
					++sessionCheck.current;
					setAuthenticated(false);
					setStatus("empty");
				})
			}
			onLookup={lookup}
			onInvalid={() => {
				setResult(null);
				setStatus("invalid");
			}}
		/>
	);
}

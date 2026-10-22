"use client";
import { passkeyClient } from "@better-auth/passkey/client";
import { zodResolver } from "@hookform/resolvers/zod";
import {
	type OrganizationLookupInput,
	organizationLookupInput,
	organizationLookupOutput,
} from "@saas-cook/backoffice-contracts";
import { createAuthClient } from "better-auth/react";
import { useState } from "react";
import { useForm } from "react-hook-form";

import { BackofficeView } from "../../components/backoffice-view";

const auth = createAuthClient({ plugins: [passkeyClient()] });
/** Runs staff ceremonies and scoped lookup; server services enforce all authority and auditing. */
export default function Page() {
	const [invitation, setInvitation] = useState(""),
		[busy, setBusy] = useState(false),
		[status, setStatus] = useState<
			"empty" | "working" | "ready" | "enrolled" | "denied" | "invalid"
		>("empty"),
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
		<BackofficeView
			busy={busy}
			status={status}
			invitation={invitation}
			result={result}
			form={form}
			onInvitationChange={setInvitation}
			onSignIn={() =>
				void run(async () => {
					const response = await auth.signIn.passkey();
					if (response?.error) throw new Error();
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
					const response = await auth.signOut();
					if (response.error) throw new Error();
					setStatus("empty");
				})
			}
			onLookup={(values) =>
				run(async () => {
					const response = await fetch("/api/organizations/lookup", {
						method: "POST",
						headers: { "content-type": "application/json" },
						body: JSON.stringify(values),
					});
					if (!response.ok) throw new Error();
					setResult(organizationLookupOutput.parse(await response.json()));
					setStatus("ready");
				})
			}
			onInvalid={() => {
				setResult(null);
				setStatus("invalid");
			}}
		/>
	);
}

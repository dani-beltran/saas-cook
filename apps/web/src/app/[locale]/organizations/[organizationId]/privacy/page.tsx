import { notFound } from "next/navigation";
import { PrivacyPage } from "../../../../../features/completion/privacy";
export const dynamic = "force-dynamic";
export default async function Page({
	params,
}: {
	params: Promise<{ organizationId: string }>;
}) {
	const { organizationId } = await params;
	if (!/^[a-f0-9-]{36}$/i.test(organizationId)) notFound();
	return <PrivacyPage key={organizationId} organizationId={organizationId} />;
}

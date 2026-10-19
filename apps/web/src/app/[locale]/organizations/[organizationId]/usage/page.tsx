import { notFound } from "next/navigation";
import { BillingPage } from "../../../../../features/billing/billing";
export const dynamic = "force-dynamic";
export default async function Page({
	params,
}: {
	params: Promise<{ organizationId: string }>;
}) {
	const { organizationId } = await params;
	if (
		!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
			organizationId,
		)
	)
		notFound();
	return (
		<BillingPage
			key={organizationId}
			organizationId={organizationId}
			usageOnly={true}
		/>
	);
}

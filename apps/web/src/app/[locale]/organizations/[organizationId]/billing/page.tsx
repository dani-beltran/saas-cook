import { publicId } from "@saas-cook/api-contracts/inputs/common";
import { notFound } from "next/navigation";
import { BillingPage } from "../../../../../features/billing/billing";
export const dynamic = "force-dynamic";
export default async function Page({
	params,
}: {
	params: Promise<{ organizationId: string }>;
}) {
	const { organizationId } = await params;
	if (!publicId.safeParse(organizationId).success) notFound();
	return (
		<BillingPage
			key={organizationId}
			organizationId={organizationId}
			usageOnly={false}
		/>
	);
}

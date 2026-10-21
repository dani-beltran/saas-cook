import { publicId } from "@saas-cook/api-contracts/inputs/common";
import { notFound } from "next/navigation";
import { DataJobsPage } from "../../../../../features/data-jobs/page";
export const dynamic = "force-dynamic";
/**
 * Renders the feature selected by this framework route.
 * @param props - params resolves the locale and/or organization ID from the route.
 * @returns The domain feature page; its services own access checks and error feedback.
 */
export default async function Page({
	params,
}: {
	params: Promise<{ organizationId: string }>;
}) {
	const { organizationId } = await params;
	if (!publicId.safeParse(organizationId).success) notFound();
	return <DataJobsPage key={organizationId} organizationId={organizationId} />;
}

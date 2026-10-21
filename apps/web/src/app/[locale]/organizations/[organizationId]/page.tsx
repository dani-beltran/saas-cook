import { publicId } from "@saas-cook/api-contracts/inputs/common";
import { notFound } from "next/navigation";
import { Organization } from "../../../../components/organization";
export const dynamic = "force-dynamic";
export default async function OrganizationPage({
	params,
}: {
	params: Promise<{ organizationId: string }>;
}) {
	const { organizationId } = await params;
	if (!publicId.safeParse(organizationId).success) notFound();
	return <Organization key={organizationId} organizationId={organizationId} />;
}

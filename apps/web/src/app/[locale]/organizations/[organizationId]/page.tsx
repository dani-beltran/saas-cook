import { notFound } from "next/navigation";
import { Organization } from "../../../../components/organization";
export const dynamic = "force-dynamic";
export default async function OrganizationPage({ params }: { params: Promise<{ organizationId: string }> }) {
	const { organizationId } = await params;
	if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(organizationId)) notFound();
	return <Organization key={organizationId} organizationId={organizationId} />;
}

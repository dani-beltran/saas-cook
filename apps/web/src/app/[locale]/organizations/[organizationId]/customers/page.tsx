import { publicId } from "@saas-cook/api-contracts/inputs/common";
import { notFound } from "next/navigation";
import { Customers } from "../../../../../features/example-customers/customers";
export const dynamic = "force-dynamic";
export default async function CustomersPage({
	params,
}: {
	params: Promise<{ organizationId: string }>;
}) {
	const { organizationId } = await params;
	if (!publicId.safeParse(organizationId).success) notFound();
	return <Customers key={organizationId} organizationId={organizationId} />;
}

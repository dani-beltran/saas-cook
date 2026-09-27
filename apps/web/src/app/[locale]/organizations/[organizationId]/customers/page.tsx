import { notFound } from "next/navigation";
import { Customers } from "../../../../../features/example-customers/customers";
export const dynamic = "force-dynamic";
export default async function CustomersPage({
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
	return <Customers key={organizationId} organizationId={organizationId} />;
}

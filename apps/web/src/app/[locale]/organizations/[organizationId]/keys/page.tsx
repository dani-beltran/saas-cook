import { notFound } from "next/navigation";
import { KeyAdministration } from "../../../../../features/platform/keys";
export const dynamic = "force-dynamic";
export default async function KeysPage({
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
		<KeyAdministration key={organizationId} organizationId={organizationId} />
	);
}

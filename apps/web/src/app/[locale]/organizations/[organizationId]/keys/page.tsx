import { publicId } from "@saas-cook/api-contracts/inputs/common";
import { notFound } from "next/navigation";
import { KeyAdministration } from "../../../../../features/platform/keys";
export const dynamic = "force-dynamic";
export default async function KeysPage({
	params,
}: {
	params: Promise<{ organizationId: string }>;
}) {
	const { organizationId } = await params;
	if (!publicId.safeParse(organizationId).success) notFound();
	return (
		<KeyAdministration key={organizationId} organizationId={organizationId} />
	);
}

import { publicId } from "@saas-cook/api-contracts/inputs/common";
import { notFound } from "next/navigation";
import { PlatformSearch } from "../../../../../features/platform/search";
export const dynamic = "force-dynamic";
export default async function SearchPage({
	params,
}: {
	params: Promise<{ organizationId: string }>;
}) {
	const { organizationId } = await params;
	if (!publicId.safeParse(organizationId).success) notFound();
	return (
		<PlatformSearch key={organizationId} organizationId={organizationId} />
	);
}

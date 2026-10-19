import { notFound } from "next/navigation";
import { PlatformSearch } from "../../../../../features/platform/search";
export const dynamic = "force-dynamic";
export default async function SearchPage({
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
		<PlatformSearch key={organizationId} organizationId={organizationId} />
	);
}

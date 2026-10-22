import { BackofficeWorkspace } from "../../../../components/backoffice-workspace";

/** Selects an organization detail route; staff scope and disclosure are checked by the audited service. */
export default async function Page({
	params,
}: {
	params: Promise<{ organizationId: string }>;
}) {
	const { organizationId } = await params;
	return (
		<BackofficeWorkspace
			key={organizationId}
			page="organization-detail"
			organizationId={organizationId}
		/>
	);
}

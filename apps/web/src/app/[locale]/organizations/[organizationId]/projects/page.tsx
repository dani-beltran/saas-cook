import { publicId } from "@saas-cook/api-contracts/inputs/common";
import { notFound } from "next/navigation";
import { Projects } from "../../../../../components/projects";
export const dynamic = "force-dynamic";
export default async function ProjectsPage({
	params,
}: {
	params: Promise<{ organizationId: string }>;
}) {
	const { organizationId } = await params;
	if (!publicId.safeParse(organizationId).success) notFound();
	return <Projects key={organizationId} organizationId={organizationId} />;
}

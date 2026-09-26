import { publicConfig } from "@common-saas/config/client";
import { Shell } from "../../../components/shell";
export const dynamic = "force-dynamic";
export default function PatternsPage() {
	return <Shell appName={publicConfig(process.env).appName} />;
}

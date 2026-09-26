import { publicConfig } from "@common-saas/config/client";
import { Shell } from "../../components/shell";

export const dynamic = "force-dynamic";

export default function HomePage() {
	const config = publicConfig(process.env);
	return <Shell appName={config.appName} />;
}

import { publicConfig } from "@saas-cook/config/client";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

export function GET() {
	redirect(`/${publicConfig(process.env).defaultLocale}`);
}

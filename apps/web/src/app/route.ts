import { publicConfig } from "@common-saas/config/client";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

export function GET() {
	redirect(`/${publicConfig(process.env).defaultLocale}`);
}

import { messages } from "@common-saas/ui/messages";
import { getRequestConfig } from "next-intl/server";

export default getRequestConfig(async ({ requestLocale }) => {
	const requested = await requestLocale;
	const locale = requested === "es" ? "es" : "en";
	return { locale, messages: messages[locale], timeZone: "UTC" };
});

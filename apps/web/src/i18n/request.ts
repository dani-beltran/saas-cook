import { getRequestConfig } from "next-intl/server";
import { localeMessages } from "./catalogs";
import { resolveLocale } from "./locales";

export default getRequestConfig(async ({ requestLocale }) => {
	const locale = resolveLocale(await requestLocale);
	return { locale, messages: localeMessages(locale), timeZone: "UTC" };
});

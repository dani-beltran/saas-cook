import { getRequestConfig } from "next-intl/server";
import en from "./messages/en/backoffice.json";
import es from "./messages/es/backoffice.json";
export default getRequestConfig(async ({ requestLocale }) => {
	const locale = await requestLocale;
	return {
		locale: locale === "es" ? "es" : "en",
		messages: locale === "es" ? es : en,
	};
});

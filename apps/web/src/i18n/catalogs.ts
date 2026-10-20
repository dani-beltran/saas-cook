import { messages } from "@saas-cook/ui/messages";
import { accountMessages } from "./account";
import type { Locale } from "./locales";
import en from "./messages/en/phase6.json";
import es from "./messages/es/phase6.json";

const phase6 = { en, es } satisfies Record<Locale, typeof en>;

/** Both the server request and client provider receive the same selected catalog. */
export function localeMessages(locale: Locale) {
	return {
		...messages[locale],
		Account: accountMessages[locale],
		Phase6: phase6[locale],
	};
}

import { redirect } from "next/navigation";
import { resolveLocale } from "../../../i18n/locales";
/**
 * Preserves existing personal privacy links after moving the controls into Account.
 * @param props - params resolves the requested locale from the route.
 * @returns Never returns; redirects to the localized account privacy tab.
 */
export default async function Page({
	params,
}: {
	params: Promise<{ locale: string }>;
}) {
	const { locale } = await params;
	redirect(`/${resolveLocale(locale)}/account#privacy`);
}

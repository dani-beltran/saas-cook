import { AboutPage } from "../../../features/public-pages/about";
/**
 * Renders the feature selected by this framework route.
 * @param props - params resolves the locale and/or organization ID from the route.
 * @returns The domain feature page; its services own access checks and error feedback.
 */
export default async function Page({
	params,
}: {
	params: Promise<{ locale: string }>;
}) {
	const { locale } = await params;
	return <AboutPage locale={locale} />;
}

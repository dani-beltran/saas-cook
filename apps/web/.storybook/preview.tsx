import "@common-saas/ui/styles.css";
import { messages } from "@common-saas/ui/messages";
import type { Preview } from "@storybook/nextjs-vite";
import { NextIntlClientProvider } from "next-intl";

export default {
	globalTypes: {
		locale: {
			description: "Language",
			toolbar: { icon: "globe", items: ["en", "es"] },
		},
		theme: {
			description: "Appearance",
			toolbar: { icon: "circlehollow", items: ["light", "dark"] },
		},
	},
	initialGlobals: { locale: "en", theme: "light" },
	decorators: [
		(Story, context) => {
			const locale = context.globals.locale === "es" ? "es" : "en";
			return (
				<NextIntlClientProvider
					locale={locale}
					messages={messages[locale]}
					timeZone="UTC"
				>
					<div
						lang={locale}
						className={context.globals.theme === "dark" ? "dark" : ""}
					>
						<div className="min-h-[360px] bg-background p-8 text-foreground">
							<div className="max-w-lg">
								<Story />
							</div>
						</div>
					</div>
				</NextIntlClientProvider>
			);
		},
	],
} satisfies Preview;

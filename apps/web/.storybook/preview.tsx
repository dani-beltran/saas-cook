import "@saas-cook/ui/styles.css";
import { messages } from "@saas-cook/ui/messages";
import {
	resolveThemeConfig,
	themeAttributes,
	themeOptions,
} from "@saas-cook/ui/theme";
import type { Preview } from "@storybook/nextjs-vite";
import { NextIntlClientProvider } from "next-intl";
import { type ReactNode, useLayoutEffect } from "react";
import { productTheme } from "../src/product-theme";

function PreviewTheme({
	children,
	globals,
}: {
	children: ReactNode;
	globals: Record<string, unknown>;
}) {
	const locale = globals.locale === "es" ? "es" : "en";
	const { palette, mode, typography, radius, shadows, density } =
		resolveThemeConfig({ ...productTheme, ...globals });
	useLayoutEffect(() => {
		const root = document.documentElement;
		const attributes = {
			...themeAttributes({
				palette,
				mode,
				typography,
				radius,
				shadows,
				density,
			}),
			lang: locale,
		};
		const previous = Object.keys(attributes).map(
			(key) => [key, root.getAttribute(key)] as const,
		);
		for (const [key, value] of Object.entries(attributes))
			root.setAttribute(key, value);
		return () => {
			for (const [key, value] of previous) {
				if (value === null) root.removeAttribute(key);
				else root.setAttribute(key, value);
			}
		};
	}, [palette, mode, typography, radius, shadows, density, locale]);
	return (
		<NextIntlClientProvider
			locale={locale}
			messages={messages[locale]}
			timeZone="UTC"
		>
			{children}
		</NextIntlClientProvider>
	);
}

export default {
	globalTypes: {
		locale: {
			description: "Language",
			toolbar: { icon: "globe", items: ["en", "es"] },
		},
		mode: {
			description: "Color mode",
			toolbar: { icon: "circlehollow", items: [...themeOptions.mode] },
		},
		palette: {
			description: "Brand palette",
			toolbar: { icon: "paintbrush", items: [...themeOptions.palette] },
		},
		density: {
			description: "Density",
			toolbar: { icon: "component", items: [...themeOptions.density] },
		},
		typography: {
			description: "Typography",
			toolbar: { items: [...themeOptions.typography] },
		},
		radius: {
			description: "Radius",
			toolbar: { items: [...themeOptions.radius] },
		},
		shadows: {
			description: "Shadows",
			toolbar: { items: [...themeOptions.shadows] },
		},
	},
	initialGlobals: { locale: "en", ...productTheme },
	decorators: [
		(Story, context) => (
			<PreviewTheme globals={context.globals}>
				<div
					className={
						context.parameters.dashboard
							? "bg-background text-foreground"
							: "min-h-[360px] bg-background p-8 text-foreground"
					}
				>
					<div
						className={context.parameters.dashboard ? undefined : "max-w-lg"}
					>
						<Story />
					</div>
				</div>
			</PreviewTheme>
		),
	],
} satisfies Preview;

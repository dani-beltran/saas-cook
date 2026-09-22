import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { Html, Text } from "@react-email/components";
import { render } from "@react-email/render";
import { createEnv } from "@t3-oss/env-core";
import { NextIntlClientProvider, useTranslations } from "next-intl";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
const schema = z.object({ name: z.string().min(1) });
function Form() {
	const form = useForm({
		resolver: zodResolver(schema),
		defaultValues: { name: "" },
	});
	const t = useTranslations();
	return (
		<form>
			<label htmlFor="name">{t("name")}</label>
			<input id="name" {...form.register("name")} />
		</form>
	);
}
describe("required-stack adapter compatibility", () => {
	it("renders React 19 forms with next-intl and Zod resolver", () => {
		const html = renderToStaticMarkup(
			<NextIntlClientProvider
				locale="en"
				timeZone="UTC"
				messages={{ name: "Name" }}
			>
				<Form />
			</NextIntlClientProvider>,
		);
		expect(html).toContain("Name");
		expect(html).toContain('name="name"');
	});
	it("renders localized React Email on the selected React version", async () => {
		const html = await render(
			<Html lang="en">
				<Text>Confirm your sign-in</Text>
			</Html>,
		);
		expect(html).toContain("Confirm your sign-in");
		expect(html).toContain('lang="en"');
	});
	it("T3 Env rejects missing server configuration before work starts", () => {
		const config = {
			server: { DATABASE_URL: z.url() },
			runtimeEnv: {},
			onValidationError: () => {
				throw new Error("Invalid runtime configuration");
			},
		};
		expect(() => createEnv(config)).toThrow("Invalid runtime configuration");
		expect(
			createEnv({
				...config,
				runtimeEnv: { DATABASE_URL: "postgres://localhost/phase0" },
			}).DATABASE_URL,
		).toBe("postgres://localhost/phase0");
	});
	it("form resolver returns field errors for invalid server-shared schema input", async () => {
		const result = await zodResolver(schema)(
			{ name: "" },
			{},
			{ fields: {}, shouldUseNativeValidation: false },
		);
		expect(result.errors.name).toBeDefined();
		expect(result.values).toEqual({});
	});
});

import { expect, it } from "vitest";
import { renderRuntimeEmail } from "./index";

it("renders localized, credential-free React Email HTML and plaintext", async () => {
	const english = await renderRuntimeEmail("en");
	const spanish = await renderRuntimeEmail("es");
	expect(english.html).toContain('lang="en"');
	expect(spanish.html).toContain('lang="es"');
	expect(english.text.toLowerCase()).toContain("your application is ready");
	expect(spanish.text.toLowerCase()).toContain("tu aplicación está lista");
	expect(english.subject).not.toBe(spanish.subject);
	expect(english.html).not.toContain("localhost");
});

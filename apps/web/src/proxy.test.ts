import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { proxy } from "./proxy";

const request = (url: string, method = "GET") =>
	new NextRequest(url, { method, headers: { host: new URL(url).host } });

afterEach(() => vi.unstubAllEnvs());

describe("local canonical authentication origin", () => {
	it("redirects loopback page aliases while preserving path and confirmation query", () => {
		vi.stubEnv("APP_ORIGIN", "http://localhost:3000");
		const response = proxy(
			request("http://127.0.0.1:3000/auth/confirm?token=synthetic&locale=es"),
		);
		expect(response.status).toBe(307);
		expect(response.headers.get("location")).toBe(
			"http://localhost:3000/auth/confirm?token=synthetic&locale=es",
		);
		expect(response.headers.get("cache-control")).toBe("no-store");
		expect(response.headers.get("referrer-policy")).toBe("no-referrer");
		vi.stubEnv("APP_ORIGIN", "http://127.0.0.1:3000");
		expect(
			proxy(request("http://localhost:3000/en/account")).headers.get(
				"location",
			),
		).toBe("http://127.0.0.1:3000/en/account");
	});

	it("does not redirect canonical, foreign, different-port or mutation requests", () => {
		vi.stubEnv("APP_ORIGIN", "http://localhost:3000");
		for (const url of [
			"http://localhost:3000/en/account",
			"http://127.0.0.1:3001/en/account",
			"http://evil.test:3000/en/account",
		])
			expect(proxy(request(url)).headers.has("location")).toBe(false);
		expect(
			proxy(request("http://127.0.0.1:3000/en/account", "POST")).headers.has(
				"location",
			),
		).toBe(false);
		vi.stubEnv("APP_ORIGIN", "https://app.example.test");
		expect(
			proxy(request("http://127.0.0.1:3000/en/account")).headers.has(
				"location",
			),
		).toBe(false);
	});
});

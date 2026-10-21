import { createHmac } from "node:crypto";
import { expect, it, vi } from "vitest";
import { POST } from "./route";

const runtime = vi.hoisted(() => ({
	feedbackSecret: "synthetic-feedback-secret",
	ready: vi.fn(async () => {}),
	platformModules: { notifications: { feedback: vi.fn(async () => {}) } },
}));
vi.mock("@saas-cook/api/runtime", () => ({
	applicationRuntime: () => runtime,
}));

it("validates signed feedback structure while retaining signature and freshness checks", async () => {
	const id = "12345678-1234-4234-8234-123456789abc";
	const call = (payload: unknown, age = 0, corrupt = false) => {
		const body = JSON.stringify(payload);
		const timestamp = String(Math.floor(Date.now() / 1000) - age);
		const signature = createHmac("sha256", runtime.feedbackSecret)
			.update(`${timestamp}.${body}`)
			.digest("hex");
		return POST(
			new Request("http://localhost/api/webhooks/optional-email", {
				method: "POST",
				headers: {
					"x-email-timestamp": timestamp,
					"x-email-signature": corrupt ? "0".repeat(64) : signature,
				},
				body,
			}),
		);
	};
	for (const payload of [
		null,
		[],
		{ id: "-".repeat(36), reason: "bounce" },
		{ id, reason: "unknown" },
		{ id, reason: "bounce", userId: id },
	])
		expect((await call(payload)).status).toBe(400);
	expect((await call({ id, reason: "bounce" }, 301)).status).toBe(400);
	expect((await call({ id, reason: "bounce" }, 0, true)).status).toBe(400);
	expect(runtime.platformModules.notifications.feedback).not.toHaveBeenCalled();
	for (const reason of ["bounce", "complaint"])
		expect((await call({ id, reason })).status).toBe(200);
	expect(runtime.platformModules.notifications.feedback).toHaveBeenCalledTimes(
		2,
	);
	expect(
		runtime.platformModules.notifications.feedback,
	).toHaveBeenLastCalledWith(id);
});

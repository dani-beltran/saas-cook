import type { LogRecord } from "@logtape/logtape";
import { trace } from "@opentelemetry/api";
import { expect, it } from "vitest";
import {
	initializeObservability,
	serializeLog,
	traceCarrier,
	withOperation,
} from "./index";

it("redacts credentials, authentication URLs, nested payloads and interpolated messages", () => {
	const record: LogRecord = {
		category: ["common-saas"],
		level: "info",
		timestamp: 0,
		rawMessage: "https://app.test/magic?token=secret",
		message: ["password=secret"],
		properties: {
			requestId: "req-1",
			token: "secret",
			authorization: "Bearer secret",
			payload: { password: "secret" },
			operation: "https://app.test?token=secret",
		},
	};
	expect(JSON.parse(serializeLog(record))).toEqual({
		timestamp: "1970-01-01T00:00:00.000Z",
		level: "info",
		event: "redacted_event",
		requestId: "req-1",
	});
});
it("propagates a real OpenTelemetry trace from request to job", async () => {
	initializeObservability("web");
	await withOperation("request", { requestId: "request-1" }, async () => {
		const traceId = trace.getActiveSpan()?.spanContext().traceId;
		const carrier = traceCarrier();
		expect(carrier.traceparent).toMatch(/^00-/);
		await withOperation(
			"job",
			{ requestId: "request-1", jobId: "job-1" },
			async () => {
				expect(trace.getActiveSpan()?.spanContext().traceId).toBe(traceId);
			},
			carrier,
		);
	});
});

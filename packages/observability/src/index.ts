import { AsyncLocalStorage } from "node:async_hooks";
import { configureSync, getLogger, type LogRecord } from "@logtape/logtape";
import {
	context,
	propagation,
	SpanStatusCode,
	trace,
} from "@opentelemetry/api";
import { NodeTracerProvider } from "@opentelemetry/sdk-trace-node";

const fields = new Set([
	"requestId",
	"jobId",
	"traceId",
	"spanId",
	"service",
	"operation",
	"status",
	"durationMs",
]);
const correlations = new AsyncLocalStorage<Record<string, string>>();
let configured = false;
let provider: NodeTracerProvider | undefined;

export function serializeLog(record: LogRecord): string {
	const properties = Object.fromEntries(
		Object.entries(record.properties).filter(
			([key, value]) =>
				fields.has(key) &&
				(typeof value === "number" ||
					(typeof value === "string" && /^[\w.:/-]{1,160}$/.test(value))),
		),
	);
	// LogTape interpolation/raw messages can contain secrets: only a fixed event code is emitted.
	const event =
		typeof record.rawMessage === "string" &&
		/^[a-z][a-z0-9_.]{0,79}$/.test(record.rawMessage)
			? record.rawMessage
			: "redacted_event";
	return JSON.stringify({
		timestamp: new Date(record.timestamp).toISOString(),
		level: record.level,
		event,
		...properties,
	});
}
export function initializeObservability(service: "web" | "worker" | "command") {
	if (!configured) {
		provider = new NodeTracerProvider();
		provider.register();
		configureSync({
			sinks: {
				stdout: (record) => process.stdout.write(`${serializeLog(record)}\n`),
			},
			loggers: [
				{ category: ["common-saas"], lowestLevel: "info", sinks: ["stdout"] },
				{
					category: ["logtape", "meta"],
					lowestLevel: "warning",
					sinks: ["stdout"],
				},
			],
		});
		configured = true;
	}
	logEvent("runtime.started", { service });
}
/** Server-operation correlation only. Never reads request headers, arbitrary log fields or payloads. */
export function getOperationContext():
	| Readonly<{ requestId: string; traceId?: string }>
	| undefined {
	const requestId = correlations.getStore()?.requestId;
	if (
		!requestId ||
		!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
			requestId,
		)
	)
		return undefined;
	const traceId = trace.getActiveSpan()?.spanContext().traceId;
	return Object.freeze({
		requestId,
		...(traceId &&
		/^[0-9a-f]{32}$/.test(traceId) &&
		traceId !== "00000000000000000000000000000000"
			? { traceId }
			: {}),
	});
}
export function logEvent(
	event: string,
	properties: Record<string, unknown> = {},
) {
	const active = trace.getActiveSpan()?.spanContext();
	getLogger(["common-saas"]).info(event, {
		...properties,
		...correlations.getStore(),
		...(active ? { traceId: active.traceId, spanId: active.spanId } : {}),
	});
}
export async function withOperation<T>(
	operation: string,
	correlation: { requestId?: string; jobId?: string },
	action: () => Promise<T>,
	carrier: Record<string, string> = {},
) {
	const parent = propagation.extract(context.active(), carrier);
	return context.with(parent, () =>
		trace.getTracer("common-saas").startActiveSpan(operation, async (span) => {
			try {
				return await correlations.run(
					Object.fromEntries(
						Object.entries(correlation).filter(
							(entry): entry is [string, string] => entry[1] !== undefined,
						),
					),
					async () => {
						logEvent("operation.started", { operation });
						const result = await action();
						logEvent("operation.completed", { operation });
						return result;
					},
				);
			} catch (error) {
				span.setStatus({ code: SpanStatusCode.ERROR });
				logEvent("operation.failed", { operation });
				throw error;
			} finally {
				span.end();
			}
		}),
	);
}
export function traceCarrier(): Record<string, string> {
	const carrier: Record<string, string> = {};
	propagation.inject(context.active(), carrier);
	return carrier;
}
export async function shutdownObservability() {
	await provider?.shutdown();
}

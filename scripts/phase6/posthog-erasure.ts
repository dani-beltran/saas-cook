import { randomUUID } from "node:crypto";
import { readFile, rename, writeFile } from "node:fs/promises";
import { z } from "zod";
import { posthogProvider } from "../../packages/db/src/analytics/provider";

// Resume an explicitly scoped historical probe without capturing or requesting deletion.
const file = process.argv[2];
if (!file) throw new Error("Usage: posthog-erasure.ts STATE_FILE");
const stateSchema = z.object({
	version: z.literal(1),
	host: z.url(),
	projectId: z.string().regex(/^\d+$/),
	subject: z.string().min(1).max(256),
	eventId: z.uuid(),
	receipt: z.object({
		personIds: z.array(z.uuid()).min(1).max(100),
		requestedAt: z.iso.datetime(),
	}),
	state: z.enum(["pending", "verified"]),
	observations: z.array(
		z.object({
			checkedAt: z.iso.datetime(),
			outcome: z.enum(["pending", "verified", "error"]),
		}),
	),
});
const state = stateSchema.parse(JSON.parse(await readFile(file, "utf8")));
const env = process.env;
if (!env.POSTHOG_TOKEN || !env.POSTHOG_PERSONAL_KEY)
	throw new Error("Provider credentials required");
if (
	state.host !== env.POSTHOG_HOST ||
	state.projectId !== env.POSTHOG_PROJECT_ID
)
	throw new Error("Tracked provider scope does not match configuration");
if (state.state === "verified") {
	console.log(
		JSON.stringify({
			state: state.state,
			observations: state.observations.length,
		}),
	);
} else {
	const provider = posthogProvider({
		host: state.host,
		projectId: state.projectId,
		token: env.POSTHOG_TOKEN ?? "",
		personalKey: env.POSTHOG_PERSONAL_KEY ?? "",
	});
	let outcome: "pending" | "verified" | "error" = "error";
	try {
		outcome = (await provider.deletionComplete({
			...state.receipt,
			subject: state.subject,
		}))
			? "verified"
			: "pending";
	} catch {
		/* Record a resumable failure without exposing provider bodies or credentials. */
	}
	state.observations.push({ checkedAt: new Date().toISOString(), outcome });
	if (outcome === "verified") state.state = "verified";
	const temporary = `${file}.${randomUUID()}.tmp`;
	await writeFile(temporary, `${JSON.stringify(state, null, 2)}\n`, {
		mode: 0o600,
		flag: "wx",
	});
	await rename(temporary, file);
	console.log(
		JSON.stringify({
			state: state.state,
			outcome,
			observations: state.observations.length,
		}),
	);
	if (outcome === "error") process.exitCode = 1;
}

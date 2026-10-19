import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Pool } from "pg";
import {
	createStripeProvider,
	stripeApiVersion,
} from "../../packages/db/src/billing/stripe";
import { acceptStripeWebhook } from "../../packages/db/src/billing/worker";

/** Real Stripe CLI transport. Secrets and raw events remain in memory, never diagnostic output. */
export async function startWebhookForwarder(
	pool: Pool,
	options: Parameters<typeof createStripeProvider>[0],
	executable: string,
) {
	const directory = await mkdtemp(join(tmpdir(), "phase5-webhooks-"));
	let provider: ReturnType<typeof createStripeProvider> | undefined;
	let last: { raw: Buffer; signature: string } | undefined;
	let received = 0,
		rejected = 0;
	const server = createServer(async (req, res) => {
		try {
			if (req.method !== "POST" || req.url !== "/stripe" || !provider) {
				res.writeHead(503).end();
				return;
			}
			const chunks: Buffer[] = [];
			let size = 0;
			for await (const chunk of req) {
				size += chunk.length;
				if (size > 262144) throw new Error("size");
				chunks.push(chunk);
			}
			const raw = Buffer.concat(chunks),
				signature = String(req.headers["stripe-signature"] ?? "");
			await acceptStripeWebhook(pool, provider, raw, signature);
			last = { raw, signature };
			received++;
			res.writeHead(200).end();
		} catch {
			rejected++;
			res.writeHead(400).end();
		}
	});
	await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
	const address = server.address();
	if (!address || typeof address === "string")
		throw new Error("Listener address");
	const child = spawn(
		executable,
		[
			"listen",
			"--latest",
			"--skip-update",
			"--events",
			"customer.subscription.created,customer.subscription.updated,customer.subscription.deleted,invoice.paid,invoice.payment_failed,checkout.session.completed",
			"--forward-to",
			`http://127.0.0.1:${address.port}/stripe`,
			"--config",
			join(directory, "config.toml"),
		],
		{
			env: { ...process.env, STRIPE_API_KEY: options.secretKey },
			stdio: ["ignore", "pipe", "pipe"],
		},
	);
	async function close() {
		child.kill("SIGTERM");
		await new Promise<void>((resolve) => {
			if (child.exitCode !== null) return resolve();
			const timer = setTimeout(() => {
				child.kill("SIGKILL");
				resolve();
			}, 3000);
			child.once("exit", () => {
				clearTimeout(timer);
				resolve();
			});
		});
		await new Promise<void>((resolve) => server.close(() => resolve()));
		await rm(directory, { recursive: true, force: true });
	}
	try {
		await new Promise<void>((resolve, reject) => {
			const timer = setTimeout(
				() => reject(new Error("Stripe listener prerequisite unavailable")),
				20000,
			);
			let buffer = "";
			const read = (chunk: Buffer) => {
				buffer = (buffer + chunk.toString()).slice(-4096);
				const secret = buffer.match(/whsec_[A-Za-z0-9]+/)?.[0];
				if (secret) {
					const version = buffer.match(/Stripe API Version \[([^\]]+)\]/)?.[1];
					if (version !== stripeApiVersion) {
						buffer = "";
						clearTimeout(timer);
						reject(
							new Error(
								"Stripe listener API version differs from application pin",
							),
						);
						return;
					}
					provider = createStripeProvider({
						...options,
						webhookSecret: secret,
					});
					buffer = "";
					clearTimeout(timer);
					resolve();
				}
			};
			child.stdout.on("data", read);
			child.stderr.on("data", read);
			child.once("error", () => {
				clearTimeout(timer);
				reject(new Error("Stripe CLI unavailable"));
			});
			child.once("exit", () => {
				clearTimeout(timer);
				reject(new Error("Stripe listener exited"));
			});
		});
	} catch (e) {
		await close();
		throw e;
	}
	return {
		apiVersion: stripeApiVersion,
		close,
		counts: () => ({ received, rejected }),
		async replay() {
			if (!last || !provider) throw new Error("No real delivered event");
			await acceptStripeWebhook(pool, provider, last.raw, last.signature);
		},
	};
}

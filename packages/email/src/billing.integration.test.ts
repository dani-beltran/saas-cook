import { randomUUID } from "node:crypto";
import { afterEach, expect, it } from "vitest";
import { billingFixture } from "../../db/src/billing/fixture";
import { enqueueBillingNotice } from "../../db/src/billing/usage";
import { withTenantTransaction } from "../../db/src/tenancy";
import { deliverBillingNotices } from "./billing";
import { createSmtpTransport } from "./smtp";

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
	for (const clean of cleanups.splice(0)) await clean();
});
it("atomically deduplicates, encrypts, retries and purges billing notices using current recipient permission", async () => {
	const f = await billingFixture();
	cleanups.push(f.cleanup);
	const enqueue = () =>
		withTenantTransaction(f.web, f.org, [f.owner.userId], true, (c) =>
			enqueueBillingNotice(c, f.org, "threshold-test", "threshold", {
				threshold: 80,
				periodEnd: "2026-10-01T00:00:00Z",
			}),
		);
	await enqueue();
	await enqueue();
	const messages: Array<{ id: string; text: string }> = [],
		options = {
			secret: f.installation.env.AUTH_SECRET,
			origin: "http://localhost:3000",
			ready: f.authorization.publication,
			authorize: (
				c: Parameters<typeof f.authorization.authorize>[0],
				u: string,
				o: string,
			) => f.authorization.authorize(c, u, o, "billing"),
			transport: async (message: { id: string; text: string }) => {
				messages.push(message);
			},
		};
	await expect(
		withTenantTransaction(f.web, f.org, [f.owner.userId], true, async (c) => {
			await enqueueBillingNotice(c, f.org, "rolled-back", "billing", {});
			throw new Error("rollback");
		}),
	).rejects.toThrow();
	const failed = await deliverBillingNotices(f.workerPool, {
		...options,
		transport: async () => {
			throw new Error("synthetic transport failure");
		},
	});
	expect(failed.failed).toBe(1);
	const row = (
		await f.app.query(
			"SELECT * FROM tenancy.billing_deliveries WHERE organization_id=$1",
			[f.org],
		)
	).rows[0];
	expect(row.encrypted_payload).not.toContain("example.test");
	expect(row.attempts).toBe(1);
	// Millisecond column rounding can place now() fractionally in the future. Force a due retry.
	await f.app.query(
		"UPDATE tenancy.billing_deliveries SET available_at=clock_timestamp()-interval '1 second' WHERE id=$1",
		[row.id],
	);
	const retry = await deliverBillingNotices(f.workerPool, options);
	const debug = await f.app.query(
		"SELECT state,available_at,expires_at,clock_timestamp() AS database_now FROM tenancy.billing_deliveries WHERE organization_id=$1",
		[f.org],
	);
	expect(
		messages,
		JSON.stringify({ retry, rows: debug.rows, host: new Date() }),
	).toHaveLength(1);
	expect(messages[0].id).toBe(row.id);
	expect(
		(
			await f.app.query(
				"SELECT encrypted_payload,state FROM tenancy.billing_deliveries WHERE id=$1",
				[row.id],
			)
		).rows[0],
	).toEqual({ encrypted_payload: "", state: "delivered" });
	await deliverBillingNotices(f.workerPool, options);
	expect(messages).toHaveLength(1);
	expect(
		(
			await f.app.query(
				"SELECT count(*) FROM tenancy.billing_notices WHERE organization_id=$1",
				[f.org],
			)
		).rows[0].count,
	).toBe("1");
	await withTenantTransaction(f.web, f.org, [f.owner.userId], true, (c) =>
		enqueueBillingNotice(c, f.org, randomUUID(), "billing", {}),
	);
	await deliverBillingNotices(f.workerPool, {
		...options,
		transport: async () => {
			throw new Error("offline");
		},
	});
	await f.app.query(
		"UPDATE tenancy.billing_deliveries SET expires_at=now()-interval '1 second',available_at=clock_timestamp()-interval '1 second' WHERE state='pending'",
	);
	const expiry = await deliverBillingNotices(f.workerPool, options);
	expect(
		(
			await f.app.query(
				"SELECT count(*) FROM tenancy.billing_deliveries WHERE state='expired' AND encrypted_payload='' ",
			)
		).rows[0].count,
		JSON.stringify({
			expiry,
			rows: (
				await f.app.query(
					"SELECT state,available_at,expires_at,clock_timestamp() AS database_now FROM tenancy.billing_deliveries WHERE organization_id=$1",
					[f.org],
				)
			).rows,
			host: new Date(),
		}),
	).toBe("1");
});

it("delivers localized lifecycle mail through real disposable SMTP", async () => {
	const f = await billingFixture();
	cleanups.push(f.cleanup);
	await withTenantTransaction(f.web, f.org, [f.owner.userId], true, (c) =>
		enqueueBillingNotice(c, f.org, "smtp-lifecycle", "billing", {
			accessState: "grace",
			effectiveAt: "2026-10-01T00:00:00Z",
		}),
	);
	const result = await deliverBillingNotices(f.workerPool, {
		secret: f.installation.env.AUTH_SECRET,
		origin: "http://localhost:3000",
		ready: f.authorization.publication,
		authorize: (c, u, o) => f.authorization.authorize(c, u, o, "billing"),
		transport: createSmtpTransport({
			host: process.env.SMTP_HOST ?? "127.0.0.1",
			port: Number(process.env.SMTP_PORT ?? 1026),
			from: "billing@example.test",
		}),
	});
	expect(result.delivered).toBe(1);
	const response = await fetch(
		`${process.env.MAILPIT_HTTP_URL ?? "http://127.0.0.1:8026"}/api/v1/search?query=${encodeURIComponent(`to:${f.owner.userId}@example.test`)}`,
	);
	expect(response.ok).toBe(true);
	const messages = (await response.json()).messages as { ID: string }[];
	expect(messages).toHaveLength(1);
	const message = await (
		await fetch(
			`${process.env.MAILPIT_HTTP_URL ?? "http://127.0.0.1:8026"}/api/v1/message/${messages[0].ID}`,
		)
	).json();
	expect(message.Text).toContain("A payment is overdue");
	expect(message.HTML).toContain("Next billing lifecycle date");
});

it("revokes a queued recipient after membership removal and bounds exhausted delivery", async () => {
	const f = await billingFixture();
	cleanups.push(f.cleanup);
	const manager = await f.user(),
		id = await f.member(f.owner, f.org, manager);
	await f.tenancy.transitionMembership(f.owner, f.org, {
		membershipId: id,
		role: "billing",
		status: "active",
		billable: false,
		operationKey: randomUUID(),
	});
	await withTenantTransaction(f.web, f.org, [f.owner.userId], true, (c) =>
		enqueueBillingNotice(c, f.org, "recipient-recheck", "billing", {
			accessState: "active",
		}),
	);
	const options = {
		secret: f.installation.env.AUTH_SECRET,
		origin: "http://localhost:3000",
		ready: f.authorization.publication,
		authorize: (
			c: Parameters<typeof f.authorization.authorize>[0],
			u: string,
			o: string,
		) => f.authorization.authorize(c, u, o, "billing"),
	};
	expect(
		(
			await deliverBillingNotices(f.workerPool, {
				...options,
				transport: async () => {
					throw new Error("offline");
				},
			})
		).failed,
	).toBe(2);
	await f.tenancy.transitionMembership(f.owner, f.org, {
		membershipId: id,
		role: "billing",
		status: "inactive",
		billable: false,
		operationKey: randomUUID(),
	});
	await f.app.query(
		"UPDATE tenancy.billing_deliveries SET available_at=clock_timestamp()-interval '1 second',attempts=7 WHERE organization_id=$1",
		[f.org],
	);
	let attempts = 0;
	expect(
		(
			await deliverBillingNotices(f.workerPool, {
				...options,
				transport: async () => {
					attempts++;
					throw new Error("still offline");
				},
			})
		).failed,
	).toBe(1);
	expect(attempts).toBe(1);
	const rows = (
		await f.app.query(
			"SELECT user_id,state,attempts,encrypted_payload FROM tenancy.billing_deliveries WHERE organization_id=$1",
			[f.org],
		)
	).rows;
	expect(rows.find((r) => r.user_id === manager.userId)).toMatchObject({
		state: "revoked",
		encrypted_payload: "",
	});
	expect(rows.find((r) => r.user_id === f.owner.userId)).toMatchObject({
		state: "failed",
		attempts: 8,
		encrypted_payload: "",
	});
	await deliverBillingNotices(f.workerPool, {
		...options,
		transport: async () => {
			attempts++;
		},
	});
	expect(attempts).toBe(1);
});

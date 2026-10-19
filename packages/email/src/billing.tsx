import {
	createCipheriv,
	createDecipheriv,
	createHash,
	randomBytes,
	randomUUID,
} from "node:crypto";
import {
	Body,
	Button,
	Container,
	Heading,
	Html,
	Text,
} from "@react-email/components";
import { render } from "@react-email/render";
import type { Pool, PoolClient } from "pg";
import { z } from "zod";
import type { EmailTransport } from "./delivery";

const payloadSchema = z.strictObject({
	to: z.email(),
	locale: z.enum(["en", "es"]),
	kind: z.enum(["billing", "threshold"]),
	url: z.url(),
	accessState: z
		.enum([
			"free",
			"trial",
			"pending",
			"active",
			"grace",
			"restricted",
			"canceled",
		])
		.optional(),
	effectiveAt: z.iso.datetime().nullable().optional(),
	threshold: z.number().int().min(1).max(100).optional(),
	periodEnd: z.iso.datetime().optional(),
	overCapacity: z.boolean().optional(),
});
type Payload = z.infer<typeof payloadSchema>;
const copy = {
	en: {
		billing: "Your billing status changed",
		threshold: "Project usage threshold reached",
		open: "Review billing and usage",
		body: "Review the current subscription, effective dates and confirmed seat capacity in your organization.",
		usage: "Your organization has reached",
		allowance: "of its monthly Project creation allowance.",
		over: "Your organization is above its confirmed seat capacity. Additional seat admission is blocked; existing memberships are preserved.",
		reset: "The usage window ends on",
		effective: "Next billing lifecycle date",
		states: {
			free: "Local Foundation access is active.",
			trial: "Your confirmed trial is active.",
			pending:
				"Payment confirmation is pending. Paid access has not been granted.",
			active: "Your paid subscription is active.",
			grace: "A payment is overdue. Your configured grace period applies.",
			restricted:
				"Your paid access is restricted. Review payment and reconciliation status.",
			canceled:
				"Your subscription has ended. Review your current access and options.",
		},
	},
	es: {
		billing: "Ha cambiado el estado de facturación",
		threshold: "Se ha alcanzado un umbral de uso",
		open: "Revisar facturación y uso",
		body: "Revisa la suscripción actual, las fechas de efecto y la capacidad de puestos confirmada de tu organización.",
		usage: "Tu organización ha alcanzado el",
		allowance: "de su límite mensual de creación de proyectos.",
		over: "Tu organización supera la capacidad de puestos confirmada. Se bloquean nuevas admisiones; se conservan las membresías existentes.",
		reset: "El período de uso termina el",
		effective: "Próxima fecha del ciclo de facturación",
		states: {
			free: "El acceso local de Foundation está activo.",
			trial: "Tu período de prueba confirmado está activo.",
			pending:
				"La confirmación del pago está pendiente. Aún no se ha concedido acceso de pago.",
			active: "Tu suscripción de pago está activa.",
			grace: "Hay un pago vencido. Se aplica el período de gracia configurado.",
			restricted:
				"Tu acceso de pago está restringido. Revisa el pago y la conciliación.",
			canceled:
				"Tu suscripción ha terminado. Revisa tu acceso y opciones actuales.",
		},
	},
};
export async function renderBillingEmail(input: Payload) {
	const p = payloadSchema.parse(input),
		t = copy[p.locale],
		subject = t[p.kind];
	const element = (
		<Html lang={p.locale}>
			<Body>
				<Container>
					<Heading>{subject}</Heading>
					<Text>
						{p.kind === "threshold"
							? `${t.usage} ${p.threshold}% ${t.allowance}`
							: t.body}
					</Text>
					{p.accessState && <Text>{t.states[p.accessState]}</Text>}
					{p.effectiveAt && (
						<Text>
							{t.effective}:{" "}
							{new Date(p.effectiveAt).toLocaleDateString(p.locale, {
								timeZone: "UTC",
							})}{" "}
							(UTC).
						</Text>
					)}
					{p.overCapacity && <Text>{t.over}</Text>}
					{p.periodEnd && (
						<Text>
							{t.reset}{" "}
							{new Date(p.periodEnd).toLocaleDateString(p.locale, {
								timeZone: "UTC",
							})}{" "}
							(UTC).
						</Text>
					)}
					<Button href={p.url}>{t.open}</Button>
				</Container>
			</Body>
		</Html>
	);
	return {
		subject,
		html: await render(element),
		text: await render(element, { plainText: true }),
	};
}
function encryptionKey(secret: string) {
	if (secret.length < 32) throw new Error("Invalid notice encryption key");
	return createHash("sha256")
		.update("billing-email:v1\0")
		.update(secret)
		.digest();
}
function protect(p: Payload, secret: string, id: string) {
	const iv = randomBytes(12),
		c = createCipheriv("aes-256-gcm", encryptionKey(secret), iv);
	c.setAAD(Buffer.from(id));
	const encrypted = Buffer.concat([
		c.update(JSON.stringify(payloadSchema.parse(p))),
		c.final(),
	]);
	return Buffer.concat([iv, c.getAuthTag(), encrypted]).toString("base64url");
}
function unprotect(p: string, secret: string, id: string) {
	const b = Buffer.from(p, "base64url"),
		c = createDecipheriv(
			"aes-256-gcm",
			encryptionKey(secret),
			b.subarray(0, 12),
		);
	c.setAAD(Buffer.from(id));
	c.setAuthTag(b.subarray(12, 28));
	return payloadSchema.parse(
		JSON.parse(Buffer.concat([c.update(b.subarray(28)), c.final()]).toString()),
	);
}
/** Dedicated mandatory billing notices; no generic resource notification or identity-token payloads. */
export async function deliverBillingNotices(
	pool: Pool,
	options: {
		secret: string;
		origin: string;
		transport: EmailTransport;
		ready(c: PoolClient): Promise<unknown>;
		authorize(
			c: PoolClient,
			userId: string,
			organizationId: string,
		): Promise<void>;
	},
) {
	let delivered = 0,
		failed = 0;
	const work = await pool.query<{ organization_id: string }>(
		"SELECT * FROM foundation.billing_notice_work()",
	);
	for (const { organization_id: o } of work.rows) {
		const c = await pool.connect();
		let locked = false;
		async function transaction<T>(userId: string | null, fn: () => Promise<T>) {
			await c.query("BEGIN");
			try {
				await c.query(
					"SELECT set_config('app.organization_id',$1,true),set_config('app.authorization_expires_at','',true),set_config('lock_timeout','5s',true)",
					[o],
				);
				if (userId)
					await c.query(
						"SELECT pg_advisory_xact_lock_shared(hashtextextended($1,0))",
						[`user:${userId}`],
					);
				await c.query(
					"SELECT pg_advisory_xact_lock_shared(hashtextextended($1,0))",
					[`organization:${o}`],
				);
				await options.ready(c);
				const value = await fn();
				const valid = (
					await c.query<{ valid: boolean }>(
						"SELECT coalesce(nullif(current_setting('app.authorization_expires_at',true),'')::timestamptz>clock_timestamp(),true) AS valid",
					)
				).rows[0].valid;
				if (!valid) throw new Error("Notice authorization expired");
				await c.query("COMMIT");
				return value;
			} catch (e) {
				await c.query("ROLLBACK").catch(() => {});
				throw e;
			}
		}
		try {
			locked = (
				await c.query<{ locked: boolean }>(
					"SELECT pg_try_advisory_lock(hashtextextended($1,0)) AS locked",
					[`notice:${o}`],
				)
			).rows[0].locked;
			if (!locked) continue;
			const notices = await transaction(
				null,
				async () =>
					(
						await c.query<{
							id: string;
							kind: "billing" | "threshold";
							payload: {
								accessState?: Payload["accessState"];
								effectiveAt?: string | null;
								threshold?: number;
								periodEnd?: string;
								overCapacity?: boolean;
							};
							expires_at: Date;
						}>(
							"SELECT * FROM tenancy.billing_notices WHERE organization_id=$1 AND dispatched_at IS NULL ORDER BY created_at LIMIT 5",
							[o],
						)
					).rows,
			);
			for (const n of notices) {
				const recipients = await transaction(
					null,
					async () =>
						(
							await c.query<{ user_id: string }>(
								"SELECT user_id FROM tenancy.memberships WHERE organization_id=$1 AND status='active' AND role IN ('owner','billing') ORDER BY user_id",
								[o],
							)
						).rows,
				);
				for (const r of recipients)
					await transaction(r.user_id, async () => {
						if (n.expires_at <= new Date()) return;
						const row = (
							await c.query<{ email: string; locale: "en" | "es" }>(
								"SELECT u.email,coalesce(a.locale,'en') AS locale FROM tenancy.memberships m JOIN tenancy.organizations o ON o.id=m.organization_id CROSS JOIN LATERAL identity.lookup_user(m.user_id) u LEFT JOIN tenancy.billing_accounts a ON a.organization_id=o.id WHERE m.organization_id=$1 AND m.user_id=$2 AND m.status='active' AND m.role IN ('owner','billing') AND (m.expires_at IS NULL OR m.expires_at>clock_timestamp()) AND o.status='active' AND u.lifecycle_status='active' AND u.email_verified",
								[o, r.user_id],
							)
						).rows[0];
						if (!row) return;
						await options.authorize(c, r.user_id, o);
						const id = randomUUID(),
							payload: Payload = {
								to: row.email,
								locale: row.locale,
								kind: n.kind,
								url: new URL(
									`/${row.locale}/organizations/${o}/${n.kind === "threshold" ? "usage" : "billing"}`,
									options.origin,
								).href,
								accessState: n.payload.accessState,
								effectiveAt: n.payload.effectiveAt,
								threshold: n.payload.threshold,
								periodEnd: n.payload.periodEnd,
								overCapacity: n.payload.overCapacity,
							};
						await c.query(
							"INSERT INTO tenancy.billing_deliveries(id,organization_id,notice_id,user_id,encrypted_payload,expires_at) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(organization_id,notice_id,user_id) DO NOTHING",
							[
								id,
								o,
								n.id,
								r.user_id,
								protect(payload, options.secret, id),
								n.expires_at,
							],
						);
					});
				await transaction(null, async () => {
					await c.query(
						"UPDATE tenancy.billing_notices SET dispatched_at=clock_timestamp() WHERE organization_id=$1 AND id=$2",
						[o, n.id],
					);
				});
			}
			const pending = await transaction(
				null,
				async () =>
					(
						await c.query<{
							id: string;
							user_id: string;
							encrypted_payload: string;
							expires_at: Date;
							attempts: number;
						}>(
							"SELECT * FROM tenancy.billing_deliveries WHERE organization_id=$1 AND state='pending' AND available_at<=clock_timestamp() ORDER BY available_at LIMIT 5",
							[o],
						)
					).rows,
			);
			for (const d of pending) {
				let permitted = false;
				await transaction(d.user_id, async () => {
					let state = "pending";
					if (d.expires_at <= new Date()) state = "expired";
					else if (d.attempts >= 8) state = "failed";
					else {
						const current = await c.query(
							"SELECT 1 FROM tenancy.memberships m JOIN tenancy.organizations o ON o.id=m.organization_id CROSS JOIN LATERAL identity.lookup_user(m.user_id) u WHERE m.organization_id=$1 AND m.user_id=$2 AND m.status='active' AND m.role IN ('owner','billing') AND (m.expires_at IS NULL OR m.expires_at>clock_timestamp()) AND o.status='active' AND u.lifecycle_status='active' AND u.email_verified",
							[o, d.user_id],
						);
						if (!current.rowCount) state = "revoked";
						else await options.authorize(c, d.user_id, o);
					}
					permitted = state === "pending";
					await c.query(
						"UPDATE tenancy.billing_deliveries SET state=$3,attempts=attempts+CASE WHEN $3='pending' THEN 1 ELSE 0 END,available_at=clock_timestamp()+interval '5 minutes',encrypted_payload=CASE WHEN $3='pending' THEN encrypted_payload ELSE '' END WHERE organization_id=$1 AND id=$2",
						[o, d.id, state],
					);
				});
				if (!permitted) continue;
				try {
					const p = unprotect(d.encrypted_payload, options.secret, d.id),
						content = await renderBillingEmail(p);
					await options.transport({ to: p.to, ...content, id: d.id });
					await transaction(null, async () => {
						await c.query(
							"UPDATE tenancy.billing_deliveries SET state='delivered',encrypted_payload='' WHERE organization_id=$1 AND id=$2",
							[o, d.id],
						);
					});
					delivered++;
				} catch {
					failed++;
					await transaction(null, async () => {
						await c.query(
							"UPDATE tenancy.billing_deliveries SET state=CASE WHEN attempts>=8 THEN 'failed' ELSE 'pending' END,encrypted_payload=CASE WHEN attempts>=8 THEN '' ELSE encrypted_payload END,available_at=clock_timestamp()+make_interval(secs=>least(300,power(2,least(attempts,8))::int)) WHERE organization_id=$1 AND id=$2",
							[o, d.id],
						);
					});
				}
			}
		} finally {
			if (locked)
				await c
					.query("SELECT pg_advisory_unlock(hashtextextended($1,0))", [
						`notice:${o}`,
					])
					.catch(() => {});
			c.release();
		}
	}
	return { delivered, failed };
}

import { createHash, createPublicKey, verify } from "node:crypto";

export interface OperatorApproval {
	version: 1;
	installationId: string;
	epoch: string;
	nonce: string;
	operatorId: string;
	organizationId: string;
	subjectUserId: string;
	membershipId?: string;
	scope: "security:deactivate" | "owner:recover";
	evidenceReference: string;
	mfaAt: string;
	expiresAt: string;
	subjectAuthenticatedAt?: string;
	subjectMethod?: "passkey" | "sso" | "password" | "magic-link";
	subjectMfa?: true;
}
const uuid = (value: unknown) =>
	typeof value === "string" &&
	/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(
		value,
	);
const identifier = (value: unknown) =>
	typeof value === "string" && /^[a-zA-Z0-9_-]{1,128}$/.test(value);
const time = (value: unknown): number =>
	typeof value === "string" &&
	/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(value)
		? Date.parse(value)
		: Number.NaN;
/** The external authority signs bytes, not operator-provided booleans or unsigned CLI flags. */
export function verifyOperatorApproval(
	envelopeText: string,
	publicKeyPem: string,
	expected: {
		installationId: string;
		epoch: string;
		scope: OperatorApproval["scope"];
	},
	now = Date.now(),
): { claims: OperatorApproval; payloadHash: string } {
	const fail = () => {
		throw new Error("Invalid independent operator approval");
	};
	if (Buffer.byteLength(envelopeText) > 16_384) fail();
	let envelope: { payload?: unknown; signature?: unknown };
	try {
		envelope = JSON.parse(envelopeText);
	} catch {
		return fail();
	}
	if (
		!envelope ||
		typeof envelope !== "object" ||
		Array.isArray(envelope) ||
		Object.keys(envelope).some(
			(key) => !["payload", "signature"].includes(key),
		) ||
		typeof envelope.payload !== "string" ||
		typeof envelope.signature !== "string" ||
		!/^[A-Za-z0-9_-]+$/.test(envelope.payload) ||
		!/^[A-Za-z0-9_-]+$/.test(envelope.signature)
	)
		return fail();
	const payload = Buffer.from(envelope.payload, "base64url"),
		signature = Buffer.from(envelope.signature, "base64url");
	const key = createPublicKey(publicKeyPem);
	if (
		key.asymmetricKeyType !== "ed25519" ||
		signature.length !== 64 ||
		!verify(null, payload, key, signature)
	)
		fail();
	let claims: OperatorApproval;
	try {
		claims = JSON.parse(payload.toString("utf8"));
	} catch {
		return fail();
	}
	if (!claims || typeof claims !== "object" || Array.isArray(claims))
		return fail();
	const allowed = [
		"version",
		"installationId",
		"epoch",
		"nonce",
		"operatorId",
		"organizationId",
		"subjectUserId",
		"membershipId",
		"scope",
		"evidenceReference",
		"mfaAt",
		"expiresAt",
		"subjectAuthenticatedAt",
		"subjectMethod",
		"subjectMfa",
	];
	if (
		Object.keys(claims).some((key) => !allowed.includes(key)) ||
		claims.version !== 1 ||
		!uuid(claims.installationId) ||
		!uuid(claims.epoch) ||
		!uuid(claims.nonce) ||
		!uuid(claims.organizationId) ||
		!identifier(claims.operatorId) ||
		!identifier(claims.subjectUserId) ||
		typeof claims.evidenceReference !== "string" ||
		!/^[\x21-\x7e]{1,240}$/.test(claims.evidenceReference)
	)
		fail();
	if (
		claims.installationId !== expected.installationId ||
		claims.epoch !== expected.epoch ||
		claims.scope !== expected.scope
	)
		fail();
	const mfaAt = time(claims.mfaAt),
		expiresAt = time(claims.expiresAt);
	if (
		!Number.isFinite(mfaAt) ||
		mfaAt > now ||
		now - mfaAt > 300_000 ||
		!Number.isFinite(expiresAt) ||
		expiresAt <= now ||
		expiresAt > mfaAt + 300_000
	)
		fail();
	if (claims.scope === "owner:recover") {
		const authenticatedAt = time(claims.subjectAuthenticatedAt);
		if (
			!Number.isFinite(authenticatedAt) ||
			authenticatedAt > now ||
			now - authenticatedAt > 300_000 ||
			claims.subjectMfa !== true ||
			!["passkey", "sso", "password", "magic-link"].includes(
				claims.subjectMethod ?? "",
			) ||
			claims.membershipId !== undefined
		)
			fail();
	} else if (
		!uuid(claims.membershipId) ||
		claims.subjectAuthenticatedAt !== undefined ||
		claims.subjectMethod !== undefined ||
		claims.subjectMfa !== undefined
	)
		fail();
	return {
		claims,
		payloadHash: createHash("sha256").update(payload).digest("hex"),
	};
}

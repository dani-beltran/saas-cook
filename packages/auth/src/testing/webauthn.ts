import {
	createHash,
	generateKeyPairSync,
	randomBytes,
	sign,
} from "node:crypto";

/** A test authenticator producing real P-256 signatures. This is neither a
 * browser/device simulation nor application verification code. */
const hash = (value: Buffer | string) =>
	createHash("sha256").update(value).digest();
const bytes = (value: string) => Buffer.from(value, "base64url");
type Cbor = string | number | Buffer | Map<Cbor, Cbor>;
function encodeCbor(value: Cbor): Buffer {
	const head = (major: number, length: number) =>
		length < 24
			? Buffer.from([(major << 5) | length])
			: length < 256
				? Buffer.from([(major << 5) | 24, length])
				: Buffer.from([(major << 5) | 25, length >> 8, length & 255]);
	if (typeof value === "number")
		return value >= 0 ? head(0, value) : head(1, -1 - value);
	if (typeof value === "string") {
		const data = Buffer.from(value);
		return Buffer.concat([head(3, data.length), data]);
	}
	if (Buffer.isBuffer(value))
		return Buffer.concat([head(2, value.length), value]);
	return Buffer.concat([
		head(5, value.size),
		...[...value].flatMap(([key, item]) => [encodeCbor(key), encodeCbor(item)]),
	]);
}

export function testAuthenticator() {
	const { privateKey, publicKey } = generateKeyPairSync("ec", {
		namedCurve: "prime256v1",
	});
	const key = publicKey.export({ format: "jwk" });
	if (!key.x || !key.y)
		throw new Error("Missing test authenticator key coordinates");
	const x = key.x;
	const y = key.y;
	const credentialId = randomBytes(32);
	const id = credentialId.toString("base64url");
	let counter = 0;
	const clientData = (type: string, challenge: string, origin: string) =>
		Buffer.from(
			JSON.stringify({ type, challenge, origin, crossOrigin: false }),
		);

	return {
		id,
		register(
			challenge: string,
			origin: string,
			rpId: string,
			userVerified = true,
		) {
			const coseKey = encodeCbor(
				new Map<Cbor, Cbor>([
					[1, 2],
					[3, -7],
					[-1, 1],
					[-2, bytes(x)],
					[-3, bytes(y)],
				]),
			);
			const authData = Buffer.concat([
				hash(rpId),
				Buffer.from([0x41 | (userVerified ? 0x04 : 0)]),
				Buffer.alloc(4),
				Buffer.alloc(16),
				Buffer.from([0, credentialId.length]),
				credentialId,
				coseKey,
			]);
			const attestationObject = encodeCbor(
				new Map<Cbor, Cbor>([
					["fmt", "none"],
					["attStmt", new Map()],
					["authData", authData],
				]),
			);
			return {
				id,
				rawId: id,
				type: "public-key",
				response: {
					clientDataJSON: clientData(
						"webauthn.create",
						challenge,
						origin,
					).toString("base64url"),
					attestationObject: attestationObject.toString("base64url"),
					transports: ["internal"],
				},
				clientExtensionResults: {},
				authenticatorAttachment: "platform",
			};
		},
		authenticate(
			challenge: string,
			origin: string,
			rpId: string,
			userVerified = true,
		) {
			counter += 1;
			const counterBytes = Buffer.alloc(4);
			counterBytes.writeUInt32BE(counter);
			const authenticatorData = Buffer.concat([
				hash(rpId),
				Buffer.from([0x01 | (userVerified ? 0x04 : 0)]),
				counterBytes,
			]);
			const data = clientData("webauthn.get", challenge, origin);
			const signature = sign(
				"sha256",
				Buffer.concat([authenticatorData, hash(data)]),
				privateKey,
			);
			return {
				id,
				rawId: id,
				type: "public-key",
				response: {
					clientDataJSON: data.toString("base64url"),
					authenticatorData: authenticatorData.toString("base64url"),
					signature: signature.toString("base64url"),
				},
				clientExtensionResults: {},
			};
		},
	};
}

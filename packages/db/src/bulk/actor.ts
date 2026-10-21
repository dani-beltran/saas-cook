import type { Pool } from "pg";
/** Worker authority is limited to current assurance metadata; raw sessions and identity credentials are never readable. */
export function backgroundActors(
	pool: Pool,
	ready: () => Promise<{ epoch: string }>,
) {
	return async (sessionId: string, userId: string) => {
		const read = async () => {
			const { epoch } = await ready();
			const r = (
				await pool.query(
					"SELECT * FROM identity.background_assurance($1,$2,$3)",
					[sessionId, userId, epoch],
				)
			).rows[0];
			if (!r) throw new Error("Session no longer active");
			return r;
		};
		const r = await read();
		return {
			sessionId,
			userId,
			method: r.method as string,
			authenticatedAt: r.authenticated_at as Date,
			mfa: r.mfa as boolean,
			recoveryEpoch: r.recovery_epoch as string,
			async assertCurrent() {
				const current = await read();
				if (
					current.credential_epoch !== r.credential_epoch ||
					current.method !== r.method ||
					current.mfa !== r.mfa ||
					current.authenticated_at.getTime() !== r.authenticated_at.getTime() ||
					current.recovery_epoch !== r.recovery_epoch
				)
					throw new Error("Session no longer active");
				return current.expires_at as Date;
			},
		};
	};
}

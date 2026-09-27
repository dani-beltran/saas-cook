import { Pool } from "pg";
import { createIdentityRuntime } from "../../../auth/src/index";
import {
	createAuthorizationService,
	getPublication,
} from "../../../authz/src/index";
import { createExampleCustomersService } from "../../../db/src/example-customers/service";
import { createTenancyService } from "../../../db/src/tenancy";
import { deliverIdentityEmails } from "../../../email/src/index";

const customerFixturePassword = "Synthetic Customers password 2026!";
export type CustomerFixtureEnv = {
	DATABASE_URL: string;
	IDENTITY_DATABASE_URL: string;
	WORKER_DATABASE_URL: string;
	CONTROL_DATABASE_URL: string;
	INSTALLATION_ID: string;
	OPENFGA_API_URL: string;
	AUTH_SECRET: string;
};
/** Explicit test-only composition. Refuse ambient/non-disposable application databases. */
export function customerFixtureRuntime(
	env: CustomerFixtureEnv,
	origin: string,
) {
	const name = new URL(env.DATABASE_URL).pathname;
	if (!/^\/phase2_test_[a-f0-9]{32}$/.test(name))
		throw new Error("A disposable test installation is required");
	const web = new Pool({ connectionString: env.DATABASE_URL }),
		identityPool = new Pool({ connectionString: env.IDENTITY_DATABASE_URL }),
		worker = new Pool({ connectionString: env.WORKER_DATABASE_URL }),
		control = new Pool({ connectionString: env.CONTROL_DATABASE_URL });
	const ready = () => getPublication(control, env.INSTALLATION_ID);
	const identity = createIdentityRuntime(identityPool, {
		origin,
		secret: env.AUTH_SECRET,
		readiness: ready,
	});
	const authorization = createAuthorizationService({
		controlPool: control,
		installationId: env.INSTALLATION_ID,
		openfgaUrl: env.OPENFGA_API_URL,
	});
	const invitations = new Map<string, string>();
	const tenancy = createTenancyService(
		web,
		{
			...authorization,
			notify: async (_c, event) => {
				if (event.token) invitations.set(event.referenceId, event.token);
			},
		},
		{ defaultSeatCapacity: 100 },
	);
	const exampleCustomers = createExampleCustomersService(
		web,
		{ authorize: authorization.authorizeResource },
		{ cursorSecret: env.AUTH_SECRET },
	);
	async function request(path: string, body: object) {
		return identity.handler(
			new Request(`${origin}/api/auth/${path}`, {
				method: "POST",
				headers: { origin, "content-type": "application/json" },
				body: JSON.stringify(body),
			}),
		);
	}
	async function human(email: string, create = true) {
		let response: Response;
		if (create) {
			const registration = await request("register", {
				email,
				name: "Synthetic customer developer",
				password: customerFixturePassword,
				locale: "en",
			});
			if (!registration.ok) throw new Error("Synthetic registration failed");
			let token: string | undefined;
			await deliverIdentityEmails(worker, {
				secret: env.AUTH_SECRET,
				transport: async (message) => {
					if (message.to === email)
						token = message.text.match(
							/\/auth\/confirm\?token=([A-Za-z0-9_-]+)/,
						)?.[1];
				},
			});
			if (!token) throw new Error("Synthetic verification token missing");
			response = await request("confirm", { token });
		} else
			response = await request("sign-in/email", {
				email,
				password: customerFixturePassword,
			});
		if (!response.ok) throw new Error("Synthetic sign-in failed");
		const cookie = response.headers
			.getSetCookie()
			.map((value) => value.split(";")[0])
			.join("; ");
		const session = await identity.session(new Headers({ cookie }));
		if (!session) throw new Error("Verified fixture session missing");
		return {
			cookie,
			actor: {
				...session,
				assertCurrent: () => identity.assertCurrent(session),
			},
		};
	}
	return {
		web,
		identity,
		identityPool,
		tenancy,
		exampleCustomers,
		origin,
		ready,
		human,
		invitations,
		async close() {
			await Promise.all([
				web.end(),
				identityPool.end(),
				worker.end(),
				control.end(),
			]);
		},
	};
}

import { execFileSync, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import { cp, mkdir, mkdtemp, open, readFile, rm } from "node:fs/promises";
import { request } from "node:http";
import { createServer } from "node:https";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { backofficeFixture } from "../../packages/backoffice/src/fixture";

const f = await backofficeFixture();
// Synthetic directory scope exceeds one UI page; no live staff or customer data.
for (let index = 0; index < 11; index++) {
	const id = randomUUID();
	await f.migration.query(
		"INSERT INTO tenancy.organizations(id,name,slug) VALUES($1::uuid,$2,$1::text)",
		[id, `Synthetic directory organization ${index}`],
	);
	await f.migration.query(
		"INSERT INTO tenancy.seat_capacities(organization_id,capacity) VALUES($1,5)",
		[id],
	);
	await f.migration.query(
		"INSERT INTO backoffice.grants VALUES($1,$2,$3,$4,'test',clock_timestamp()+interval '1 hour')",
		[randomUUID(), f.operatorId, id, f.epoch],
	);
}
f.env.BACKOFFICE_ORIGIN = "https://localhost:3104";
const certDir = await mkdtemp(join(tmpdir(), "bo-browser-"));
execFileSync(
	"openssl",
	[
		"req",
		"-x509",
		"-newkey",
		"rsa:2048",
		"-nodes",
		"-days",
		"1",
		"-subj",
		"/CN=localhost",
		"-addext",
		"subjectAltName=DNS:localhost",
		"-keyout",
		join(certDir, "key.pem"),
		"-out",
		join(certDir, "cert.pem"),
	],
	{ stdio: "ignore" },
);
const ingress = createServer(
	{
		key: await readFile(join(certDir, "key.pem")),
		cert: await readFile(join(certDir, "cert.pem")),
	},
	(incoming, outgoing) => {
		const upstream = request(
			{
				hostname: "localhost",
				port: 3103,
				path: incoming.url,
				method: incoming.method,
				headers: {
					...incoming.headers,
					"x-forwarded-proto": "https",
					"x-forwarded-host": "localhost:3104",
				},
			},
			(response) => {
				outgoing.writeHead(response.statusCode ?? 503, response.headers);
				response.pipe(outgoing);
			},
		);
		upstream.on("error", () => {
			outgoing.writeHead(503);
			outgoing.end();
		});
		incoming.pipe(upstream);
	},
);
ingress.listen(3104, "localhost");
await once(ingress, "listening");
await mkdir("artifacts/backoffice", { recursive: true });
await cp(
	"apps/backoffice/.next/static",
	"apps/backoffice/.next/standalone/apps/backoffice/.next/static",
	{ recursive: true },
);
const log = await open("artifacts/backoffice/browser-server.log", "w");
const server = spawn(
	process.execPath,
	["apps/backoffice/.next/standalone/apps/backoffice/server.js"],
	{
		env: {
			...process.env,
			...f.env,
			NODE_ENV: "production",
			HOSTNAME: "localhost",
			PORT: "3103",
		},
		stdio: ["ignore", log.fd, log.fd],
	},
);
try {
	let ready = false;
	for (let i = 0; i < 100; i++) {
		try {
			ready = (await fetch("http://localhost:3103/health/live")).ok;
		} catch {}
		if (ready) break;
		await new Promise((r) => setTimeout(r, 100));
	}
	if (!ready) throw new Error("BO browser server unavailable");
	const runner = spawn(
		process.execPath,
		[
			"node_modules/@playwright/test/cli.js",
			"test",
			"--config",
			"playwright.backoffice.config.ts",
		],
		{
			env: {
				...process.env,
				...f.env,
				BO_TEST_INVITATION: f.invitation,
				BO_TEST_ORGANIZATION: f.organizationId,
				BO_TEST_OTHER_ORGANIZATION: f.otherOrganizationId,
			},
			stdio: "inherit",
		},
	);
	const [code] = await once(runner, "exit");
	if (code !== 0) throw new Error("Backoffice browser verification failed");
} finally {
	server.kill("SIGTERM");
	await once(server, "exit");
	await log.close();
	await new Promise<void>((resolve) => ingress.close(() => resolve()));
	await rm(certDir, { recursive: true, force: true });
	await f.cleanup();
}

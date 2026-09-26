import { cp, mkdir } from "node:fs/promises";

const app = new URL("../", import.meta.url);
const output = new URL(".next/standalone/apps/web/", app);
await mkdir(new URL(".next/", output), { recursive: true });
await cp(new URL(".next/static/", app), new URL(".next/static/", output), {
	recursive: true,
});
await cp(new URL("public/", app), new URL("public/", output), {
	recursive: true,
});

import { cp } from "node:fs/promises";

await cp(".next/static", ".next/standalone/apps/backoffice/.next/static", {
	recursive: true,
});
await cp("public", ".next/standalone/apps/backoffice/public", {
	recursive: true,
});

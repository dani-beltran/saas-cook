/** Process liveness only; no configuration or tenant information is disclosed. */
export function GET() {
	return Response.json({ status: "live" });
}

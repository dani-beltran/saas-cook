import { handleApi } from "@common-saas/api";
export const runtime = "nodejs";
const handler = (request: Request) => handleApi(request, "rest");

export {
	handler as GET,
	handler as POST,
	handler as PUT,
	handler as PATCH,
	handler as DELETE,
};
